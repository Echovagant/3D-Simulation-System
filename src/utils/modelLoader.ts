// src/utils/modelLoader.ts
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
 * 加载3D模型文件，返回Three.js对象
 * @param url 模型文件路径
 */
export const loadModel = async (url: string): Promise<THREE.Object3D> => {
  // 验证URL有效性
  if (!url || url === '#' || url.trim() === '') {
    throw new Error('无效的模型URL');
  }

  // 站内绝对路径（/assets/...）统一拼上 BASE_URL，支持子路径部署
  const resolvedUrl = resolveModelUrl(url);

  try {
    // 确定模型类型并使用相应的加载器
    const modelType = getModelType(resolvedUrl);

    switch (modelType) {
      case 'gltf':
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
        return new Promise((resolve, reject) => {
          fbxLoader.load(
            resolvedUrl,
            (object: THREE.Object3D) => resolve(object),
            undefined,
            (error: unknown) => reject(handleLoaderError(error, resolvedUrl))
          );
        });

      case 'obj':
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