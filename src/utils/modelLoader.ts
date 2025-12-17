// src/utils/modelLoader.ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
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
const getModelType = (url: string): 'gltf' | 'fbx' | 'obj' | 'unknown' => {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.endsWith('.glb') || lowerUrl.endsWith('.gltf')) return 'gltf';
  if (lowerUrl.endsWith('.fbx')) return 'fbx';
  if (lowerUrl.endsWith('.obj')) return 'obj';
  return 'unknown';
};


/**
 * 处理加载器错误
 */
const handleLoaderError = (error: unknown, url: string): Error => {
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

  // 处理相对路径 - 特别是以../开头的路径
  let resolvedUrl = url;
  if (url.startsWith('../')) {
    // 在Vite环境中，src/assets目录下的文件需要使用import.meta.url来处理
    // 将../assets/models/转换为正确的URL
    const baseUrl = import.meta.env.BASE_URL;
    resolvedUrl = url.replace('../assets/', `${baseUrl}src/assets/`);
  }

  try {
    // 确定模型类型并使用相应的加载器
    const modelType = getModelType(resolvedUrl);

    switch (modelType) {
      case 'gltf':
        return new Promise((resolve, reject) => {
          gltfLoader.load(
            resolvedUrl,
            (gltf) => {
              if (gltf.scene) {
                resolve(gltf.scene);
              } else {
                reject(new Error('GLTF文件不包含场景'));
              }
            },
            undefined,
            (error) => reject(handleLoaderError(error, resolvedUrl))
          );
        });

      case 'fbx':
        return new Promise((resolve, reject) => {
          fbxLoader.load(
            resolvedUrl,
            (object) => resolve(object),
            undefined,
            (error) => reject(handleLoaderError(error, resolvedUrl))
          );
        });

      case 'obj':
        return new Promise((resolve, reject) => {
          objLoader.load(
            resolvedUrl,
            (object) => resolve(object),
            undefined,
            (error) => reject(handleLoaderError(error, resolvedUrl))
          );
        });

      default:
        throw new Error(`不支持的模型格式: ${resolvedUrl}`);
    }
  } catch (error) {
    throw handleLoaderError(error, resolvedUrl);
  }
};