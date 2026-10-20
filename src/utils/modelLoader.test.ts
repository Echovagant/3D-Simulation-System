import { describe, it, expect } from 'vitest'
import { resolveModelUrl, getModelType, handleLoaderError } from './modelLoader'

describe('resolveModelUrl', () => {
  it('站内绝对路径拼上 BASE_URL', () => {
    expect(resolveModelUrl('/assets/models/x.glb')).toBe('/assets/models/x.glb')
  })
  it('非站内路径原样返回', () => {
    expect(resolveModelUrl('https://cdn.example.com/x.glb')).toBe('https://cdn.example.com/x.glb')
  })
  it('去掉前导斜杠后与 BASE_URL 拼接', () => {
    const baseUrl = import.meta.env.BASE_URL
    expect(resolveModelUrl('/assets/models/characters/Fox.glb')).toBe(
      `${baseUrl}assets/models/characters/Fox.glb`
    )
  })
})

describe('getModelType', () => {
  it('.glb 返回 gltf', () => {
    expect(getModelType('/assets/models/characters/Fox.glb')).toBe('gltf')
  })
  it('.fbx 返回 fbx，.obj 返回 obj，未知格式返回 unknown', () => {
    expect(getModelType('/a/b.fbx')).toBe('fbx')
    expect(getModelType('/a/b.obj')).toBe('obj')
    expect(getModelType('/a/b.txt')).toBe('unknown')
  })
  it('大写扩展名也能识别', () => {
    expect(getModelType('A.GLB')).toBe('gltf')
  })
})

describe('handleLoaderError', () => {
  it('把 404 错误翻译成中文提示', () => {
    const err = handleLoaderError(new Error('404 not found'), '/x.glb')
    expect(err.message).toContain('模型文件未找到')
  })
  it('把 HTML 响应错误翻译成路径提示', () => {
    const err = handleLoaderError(new Error('<!DOCTYPE html>'), '/x.glb')
    expect(err.message).toContain('模型URL返回无效内容')
  })
  it('非 Error 值也能处理', () => {
    const err = handleLoaderError('boom', '/x.glb')
    expect(err.message).toContain('模型加载失败')
  })
})
