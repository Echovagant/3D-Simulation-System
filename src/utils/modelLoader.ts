// src/utils/modelLoader.ts
/**
 * 按 URL 后缀分派的模型加载器（GLB / GLTF / FBX / OBJ）。
 *
 * 三种 loader 是模块级单例，复用解析器，不随加载次数重建。
 * ⚠️ 只认 URL 后缀：blob: 对象 URL 不带扩展名，本次会话上传的模型
 * 走 modelStore.parseModelFile（按上传时的格式直接 parse），不要进这里。
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';


// 创建不同类型的加载器
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();
const objLoader = new OBJLoader();


/**
 * 检测模型文件类型
 * @param url 模型文件路径
 */
export const getModelType = (url: string): 'gltf' | 'fbx' | 'obj' | 'unknown' => {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.endsWith('.glb') || lowerUrl.endsWith('.gltf')) return 'gltf';
  if (lowerUrl.endsWith('.fbx')) return 'fbx';
  if (lowerUrl.endsWith('.obj')) return 'obj';
  return 'unknown';
};


/**
 * 解析模型 URL
 * 站内绝对路径（/assets/...）统一拼上 BASE_URL，以支持子路径部署；
 * 外部 URL（http/https）与相对路径原样返回
 * @param url 模型文件路径
 */
export const resolveModelUrl = (url: string): string => {
  const baseUrl = import.meta.env.BASE_URL
  return url.startsWith('/') ? `${baseUrl}${url.replace(/^\//, '')}` : url
};


/**
 * 处理加载器错误
 */
export const handleLoaderError = (error: unknown, url: string): Error => {
  let errorMessage = '未知错误';

  if (error instanceof Error) {
    errorMessage = error.message;

    // 特殊处理404错误
    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      errorMessage = `模型文件未找到: ${url}`;
    }
    // 处理HTML响应错误（常见的错误页面）
    else if (errorMessage.includes('<!DOCTYPE') || errorMessage.includes('html')) {
      errorMessage = `模型URL返回无效内容，请检查路径是否正确: ${url}`;
    }
  }

  return new Error(`模型加载失败: ${errorMessage}`);
};


/**
 * 加载选项（可选）：
 * - headers：随请求发送的头。服务端持久化的模型文件端点按 owner 隔离，
 *   请求要带 `X-Owner-Token`——three.js 的 loader 自己不发头，只能在这里给。
 * - format：格式提示（glb / gltf / fbx / obj，大小写不敏感）。给定时跳过
 *   URL 后缀判型——文件端点的 URL 形如 /api/models/{id}/file，不带扩展名，
 *   getModelType 认不出来。
 */
export interface LoadModelOptions {
  headers?: Record<string, string>;
  format?: string;
}

/**
 * 格式提示 → loader 类型。认不出返回 null（调用方当格式错误处理）。
 */
const normalizeFormatHint = (format: string): 'gltf' | 'fbx' | 'obj' | null => {
  const lower = format.toLowerCase();
  if (lower === 'glb' || lower === 'gltf') return 'gltf';
  if (lower === 'fbx') return 'fbx';
  if (lower === 'obj') return 'obj';
  return null;
};

/**
 * 设置（或清掉）loader 单例上的请求头。
 *
 * loader 是模块级单例：本次设的头会留在实例上，**必须**在下一次加载前
 * 显式清空（传 undefined 就清），否则上一次的 owner 头会泄漏给内置模型
 * 的静态资源请求。
 */
const applyLoaderHeaders = (loader: THREE.Loader, headers?: Record<string, string>): void => {
  loader.setRequestHeader(headers ? { ...headers } : {});
};

/**
 * 加载3D模型文件，返回Three.js对象
 * @param url 模型文件路径
 * @param options 可选的请求头与格式提示（见 LoadModelOptions）
 */
export const loadModel = async (
  url: string,
  options?: LoadModelOptions
): Promise<THREE.Object3D> => {
  // 验证URL有效性
  if (!url || url === '#' || url.trim() === '') {
    throw new Error('无效的模型URL');
  }

  // 站内绝对路径（/assets/...）统一拼上 BASE_URL，支持子路径部署
  const resolvedUrl = resolveModelUrl(url);

  try {
    // 确定模型类型并使用相应的加载器：格式提示优先，其次按 URL 后缀
    const modelType = options?.format ? normalizeFormatHint(options.format) : getModelType(resolvedUrl);

    switch (modelType) {
      case 'gltf':
        applyLoaderHeaders(gltfLoader, options?.headers);
        return new Promise((resolve, reject) => {
          gltfLoader.load(
            resolvedUrl,
            (gltf: GLTF) => {
              if (gltf.scene) {
                resolve(gltf.scene);
              } else {
                reject(new Error('GLTF文件不包含场景'));
              }
            },
            undefined,
            (error: unknown) => reject(handleLoaderError(error, resolvedUrl))
          );
        });

      case 'fbx':
        applyLoaderHeaders(fbxLoader, options?.headers);
        return new Promise((resolve, reject) => {
          fbxLoader.load(
            resolvedUrl,
            (object: THREE.Object3D) => resolve(object),
            undefined,
            (error: unknown) => reject(handleLoaderError(error, resolvedUrl))
          );
        });

      case 'obj':
        applyLoaderHeaders(objLoader, options?.headers);
        return new Promise((resolve, reject) => {
          objLoader.load(
            resolvedUrl,
            (object: THREE.Object3D) => resolve(object),
            undefined,
            (error: unknown) => reject(handleLoaderError(error, resolvedUrl))
          );
        });

      default:
        throw new Error(`不支持的模型格式: ${resolvedUrl}`);
    }
  } catch (error) {
    throw handleLoaderError(error, resolvedUrl);
  }
};