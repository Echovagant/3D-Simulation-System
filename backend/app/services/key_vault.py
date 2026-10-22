"""托管密钥的加密与存取。

**服务端不持明文**：库里只有密文、nonce、盐与 KDF 名；明文 key 从不落盘、
不进日志、不进异常消息、不进审计表。

两种 KDF：

| 模式 | 何时用 | KEK 怎么来 |
| --- | --- | --- |
| `host` | 服务端配了 `BACKEND_KEY_MASTER_KEY` | `HKDF-SHA256(master_key, salt=行内随机盐)` |
| `argon2id` | 服务端没配 master key | `Argon2id(passphrase, 行内随机盐)` |

口令与 master key 都不落盘。argon2id 模式下，派生出来的 KEK 只留在
**进程内存**里（``_KEK_CACHE``）：用户提交一次口令就能托管，
之后同一进程内可以正常调用；进程重启后需要重新提交口令。
"""

from __future__ import annotations

import base64
import os
import threading

from argon2.low_level import Type, hash_secret_raw
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import ApiError
from app.models import LlmKeyVault, utcnow

KDF_HOST = "host"
KDF_ARGON2ID = "argon2id"

_SALT_BYTES = 16
_NONCE_BYTES = 12
_KEY_BYTES = 32

# Argon2id 参数：用官方默认档（time_cost=3 / memory_cost=64MiB / parallelism=4）。
_ARGON2_TIME_COST = 3
_ARGON2_MEMORY_COST = 65536
_ARGON2_PARALLELISM = 4

# 派生出来的 KEK 只在内存里留一份，key = (owner_token, provider_id, salt)。
# 带上 salt 是为了让「重新托管后盐变了」自然地 miss 掉旧缓存。
_KEK_CACHE: dict[tuple[str, str, str], bytes] = {}
_KEK_LOCK = threading.Lock()


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def _aad(provider_id: str, owner_token: str) -> bytes:
    """附加认证数据：密文与「哪家、谁的」绑死，搬不走。"""
    return f"{provider_id}|{owner_token}".encode()


def derive_kek_host(master_key: str, salt: bytes) -> bytes:
    """HKDF-SHA256(master_key, salt=行内随机盐) -> 32 字节 KEK。"""
    return HKDF(
        algorithm=hashes.SHA256(),
        length=_KEY_BYTES,
        salt=salt,
        info=b"3dsim/llm-key-vault/v1",
    ).derive(master_key.encode())


def derive_kek_argon2id(passphrase: str, salt: bytes) -> bytes:
    """Argon2id(passphrase, 行内随机盐) -> 32 字节 KEK。"""
    return hash_secret_raw(
        secret=passphrase.encode(),
        salt=salt,
        time_cost=_ARGON2_TIME_COST,
        memory_cost=_ARGON2_MEMORY_COST,
        parallelism=_ARGON2_PARALLELISM,
        hash_len=_KEY_BYTES,
        type=Type.ID,
    )


def _cache_kek(owner_token: str, provider_id: str, salt_b64: str, kek: bytes) -> None:
    with _KEK_LOCK:
        _KEK_CACHE[(owner_token, provider_id, salt_b64)] = kek


def _cached_kek(owner_token: str, provider_id: str, salt_b64: str) -> bytes | None:
    with _KEK_LOCK:
        return _KEK_CACHE.get((owner_token, provider_id, salt_b64))


def _forget_kek(owner_token: str, provider_id: str) -> None:
    with _KEK_LOCK:
        for key in [k for k in _KEK_CACHE if k[0] == owner_token and k[1] == provider_id]:
            del _KEK_CACHE[key]


def clear_kek_cache() -> None:
    """清空内存里的 KEK 缓存（删 key、重启进程、或测试之间用）。"""
    with _KEK_LOCK:
        _KEK_CACHE.clear()


def encrypt_secret(
    provider_id: str, owner_token: str, plaintext: str, kek: bytes
) -> tuple[str, str]:
    """AES-256-GCM 加密，返回 (密文 base64, nonce base64)。"""
    nonce = os.urandom(_NONCE_BYTES)
    ciphertext = AESGCM(kek).encrypt(nonce, plaintext.encode(), _aad(provider_id, owner_token))
    return _b64(ciphertext), _b64(nonce)


def decrypt_secret(row: LlmKeyVault, kek: bytes) -> str:
    """解密。失败说明口令不对或行被改过——让用户重新托管。"""
    try:
        raw = AESGCM(kek).decrypt(
            _unb64(row.nonce),
            _unb64(row.ciphertext),
            _aad(row.provider_id, row.owner_token),
        )
    except (InvalidTag, ValueError) as exc:
        raise ApiError(
            status_code=422,
            code="llm_invalid_request",
            message="密钥解密失败，请重新托管该厂商的 key",
        ) from exc
    return raw.decode("utf-8")


def store_key(
    session: Session,
    owner_token: str,
    provider_id: str,
    api_key: str,
    passphrase: str | None = None,
) -> LlmKeyVault:
    """托管一把密钥。

    库里**只有密文**。host 模式不需要口令；argon2id 模式必须给口令，
    没给直接 422 passphrase_required。
    """
    if settings.llm_key_master_key:
        kdf = KDF_HOST
        salt = os.urandom(_SALT_BYTES)
        kek = derive_kek_host(settings.llm_key_master_key, salt)
    else:
        if not passphrase:
            raise ApiError(
                status_code=422,
                code="passphrase_required",
                message="服务端未配置 master key，托管密钥必须提交 passphrase",
            )
        kdf = KDF_ARGON2ID
        salt = os.urandom(_SALT_BYTES)
        kek = derive_kek_argon2id(passphrase, salt)

    ciphertext, nonce = encrypt_secret(provider_id, owner_token, api_key, kek)
    salt_b64 = _b64(salt)
    now = utcnow()

    row = session.get(LlmKeyVault, (provider_id, owner_token))
    if row is None:
        row = LlmKeyVault(provider_id=provider_id, owner_token=owner_token, created_at=now)
        session.add(row)
    row.owner_token = owner_token
    row.ciphertext = ciphertext
    row.nonce = nonce
    row.salt = salt_b64
    row.kdf = kdf
    row.updated_at = now
    session.commit()
    session.refresh(row)

    _cache_kek(owner_token, provider_id, salt_b64, kek)
    return row


def get_key(session: Session, owner_token: str, provider_id: str) -> LlmKeyVault | None:
    """取某 owner 在某厂商上的密钥行。没有就是 None。"""
    stmt = select(LlmKeyVault).where(
        LlmKeyVault.provider_id == provider_id,
        LlmKeyVault.owner_token == owner_token,
    )
    return session.scalars(stmt).first()


def list_keys(session: Session, owner_token: str) -> list[LlmKeyVault]:
    stmt = select(LlmKeyVault).where(LlmKeyVault.owner_token == owner_token)
    return list(session.scalars(stmt).all())


def delete_key(session: Session, owner_token: str, provider_id: str) -> bool:
    """删掉一把密钥。删不掉返回 False（由路由转成 404 llm_key_missing）。"""
    row = get_key(session, owner_token, provider_id)
    if row is None:
        return False
    session.delete(row)
    session.commit()
    _forget_kek(owner_token, provider_id)
    return True


def resolve_plaintext(
    session: Session,
    owner_token: str,
    provider_id: str,
    passphrase: str | None = None,
) -> str | None:
    """取出明文 key。

    没托管过就是 None（由调用方转成 404 llm_key_missing）。
    argon2id 模式下若内存里没有 KEK，必须重新提交口令，否则 422 passphrase_required。
    """
    row = get_key(session, owner_token, provider_id)
    if row is None:
        return None

    kek = _cached_kek(owner_token, provider_id, row.salt)
    if kek is None:
        salt = _unb64(row.salt)
        if row.kdf == KDF_HOST:
            kek = derive_kek_host(settings.llm_key_master_key, salt)
        else:
            if not passphrase:
                raise ApiError(
                    status_code=422,
                    code="passphrase_required",
                    message="该密钥用用户口令加密，需要重新提交 passphrase",
                )
            kek = derive_kek_argon2id(passphrase, salt)
        _cache_kek(owner_token, provider_id, row.salt, kek)

    return decrypt_secret(row, kek)
