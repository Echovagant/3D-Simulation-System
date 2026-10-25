/**
 * 3D 场景的取景参数。
 *
 * 盯的是两件事：
 *
 * 1. **参数本身**：仿真实验室与 AI 演武场的相机位置、视野角、目标点。
 * 2. **同源**：相机的 `lookAt` 点与轨道控制器的 `target` 必须取自同一份配置。
 *
 * ⚠️ 第 2 条是「场景偏下」的根因：两者不一致时不会报错，控制器会在第一次
 * `update()` 时把相机改瞄到 target 那个点，画面里的内容整体被压偏。
 * 仿真实验室之前就踩过（相机 lookAt(0,0,0)、控制器 target.set(0,2,0)）。
 *
 * 断言用的是「源码里不许出现字面量的轨道中心」——写成字面量就意味着
 * 它和相机的 lookAt 可能是两个点，这是那条 bug 最初的样子。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { labFraming, arenaFraming } from './sceneFraming'

const SRC = join(process.cwd(), 'src')

const readSource = (relPath: string): string =>
  readFileSync(join(SRC, relPath), 'utf8')

describe('取景参数', () => {
  it('仿真实验室：正对场地中心、俯角 45°、视野 60°', () => {
    expect(labFraming.position).toEqual({ x: 0, y: 6, z: 6 })
    expect(labFraming.fov).toBe(60)
  })

  it('AI 演武场：正对场地中心、俯角约 38°、视野 50°', () => {
    expect(arenaFraming.position).toEqual({ x: 0, y: 27, z: 34 })
    expect(arenaFraming.fov).toBe(50)
  })

  it('两个场景的目标点都是原点', () => {
    // 原点是 OrbitControls 的默认轨道中心——目标点选原点，
    // 就连「忘了设置」也不会偏
    expect(labFraming.target).toEqual({ x: 0, y: 0, z: 0 })
    expect(arenaFraming.target).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('仿真实验室的轨道中心与相机瞄点都取自 labFraming', () => {
    const source = readSource('views/SimulationLab.vue')
    const refs = (source.match(/labFraming\.target/g) ?? []).length
    // 至少两处：相机的 lookAt 与控制器的 target.set
    expect(refs).toBeGreaterThanOrEqual(2)
  })

  it('AI 演武场的轨道中心与相机瞄点都取自 arenaFraming', () => {
    const source = readSource('views/AIPlayground.vue')
    const refs = (source.match(/arenaFraming\.target/g) ?? []).length
    expect(refs).toBeGreaterThanOrEqual(2)
  })

  it('两个页面的轨道中心都不许写字面量', () => {
    for (const file of ['views/SimulationLab.vue', 'views/AIPlayground.vue']) {
      const source = readSource(file)
      // target.set(0, 2, 0) 这种写法一旦出现，轨道中心就和相机瞄点分家了
      expect(source, file).not.toMatch(/target\.set\(\s*-?\d/)
    }
  })
})
