<template>
  <canvas ref="canvasRef" class="tech-grid-canvas"></canvas>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted } from 'vue'
import * as BABYLON from '@babylonjs/core'

const canvasRef = ref<HTMLCanvasElement | null>(null)
let engine: BABYLON.Engine | null = null
let scene: BABYLON.Scene | null = null

const createHolographicBackground = () => {
  if (!canvasRef.value) return

  engine = new BABYLON.Engine(canvasRef.value, true, {
    preserveDrawingBuffer: true,
    stencil: true,
  })
  scene = new BABYLON.Scene(engine)
  scene.clearColor = new BABYLON.Color4(0.039, 0.098, 0.184, 1) // 深蓝背景

  const camera = new BABYLON.ArcRotateCamera(
    'camera',
    Math.PI / 4,
    Math.PI / 3,
    100,
    BABYLON.Vector3.Zero(),
    scene,
  )
  camera.attachControl(canvasRef.value, false)
  camera.lowerRadiusLimit = 60
  camera.upperRadiusLimit = 150
  camera.wheelPrecision = 20
  camera.lowerAlphaLimit = 0
  camera.upperAlphaLimit = Math.PI * 2
  camera.lowerBetaLimit = Math.PI / 4
  camera.upperBetaLimit = Math.PI / 2.5

  // 环境光
  const hemisphericLight = new BABYLON.HemisphericLight(
    'hemisphericLight',
    new BABYLON.Vector3(0, 1, 0),
    scene,
  )
  hemisphericLight.intensity = 0.2

  // 全息蓝主光源
  const pointLight = new BABYLON.PointLight('pointLight', new BABYLON.Vector3(0, 50, 0), scene)
  pointLight.intensity = 0.8
  pointLight.diffuse = new BABYLON.Color3(0, 1, 0.616) // 亮绿 #00ff9d

  // 创建全息元素
  createHolographicPanels(scene)
  createRotating3DModel(scene)
  createDynamicDataCharts(scene)
  createHolographicNodes(scene)
  createHolographicParticles(scene)

  engine.runRenderLoop(() => {
    scene?.render()
  })
}

const createHolographicPanels = (scene: BABYLON.Scene) => {
  const panelCount = 4
  const panels: BABYLON.Mesh[] = []

  // 全息面板材质
  const panelMaterial = new BABYLON.StandardMaterial('panelMaterial', scene)
  panelMaterial.diffuseColor = new BABYLON.Color3(0, 1, 1) // 青色
  panelMaterial.emissiveColor = new BABYLON.Color3(0, 1, 1) // 青色
  panelMaterial.alpha = 0.1 // 透明蓝 rgba(0, 255, 255, 0.1)
  panelMaterial.specularColor = new BABYLON.Color3(0, 1, 0.616) // 亮绿
  panelMaterial.shininess = 100

  // 边框材质
  const borderMaterial = new BABYLON.StandardMaterial('borderMaterial', scene)
  borderMaterial.diffuseColor = new BABYLON.Color3(0, 1, 0.616) // 亮绿
  borderMaterial.emissiveColor = new BABYLON.Color3(0, 1, 0.616) // 亮绿
  borderMaterial.alpha = 0.8

  for (let i = 0; i < panelCount; i++) {
    // 创建面板
    const panel = BABYLON.MeshBuilder.CreatePlane(`panel${i}`, { width: 20, height: 15 }, scene)
    panel.material = panelMaterial

    // 添加边框
    const border = BABYLON.MeshBuilder.CreatePlane(
      `border${i}`,
      { width: 20.4, height: 15.4 },
      scene,
    )
    border.material = borderMaterial
    border.parent = panel

    // 面板位置
    const angle = (i / panelCount) * Math.PI * 2
    const radius = 40
    const height = (Math.random() - 0.5) * 30

    panel.position.x = Math.cos(angle) * radius
    panel.position.y = height
    panel.position.z = Math.sin(angle) * radius

    // 面板旋转
    panel.rotation.y = angle + Math.PI / 2
    panel.rotation.x = (Math.random() - 0.5) * 0.2
    panel.rotation.z = (Math.random() - 0.5) * 0.2

    panel.metadata = {
      originalAngle: angle,
      originalHeight: height,
      floatSpeed: 0.3 + Math.random() * 0.5,
      rotationSpeed: (Math.random() - 0.5) * 0.02,
    }

    panels.push(panel)
  }

  // 面板动画
  scene.registerBeforeRender(() => {
    const time = performance.now() * 0.001

    panels.forEach((panel, index) => {
      const metadata = panel.metadata

      // 轻微浮动效果
      panel.position.y = metadata.originalHeight + Math.sin(time * metadata.floatSpeed + index) * 2

      // 缓慢旋转
      panel.rotation.z += metadata.rotationSpeed

      // 呼吸效果
      const pulse = 0.08 + Math.sin(time * 2 + index) * 0.02
      panel.material.alpha = pulse
    })
  })
}

const createRotating3DModel = (scene: BABYLON.Scene) => {
  // 创建系统模型（简化版3D仿真系统模型）
  const modelGroup = new BABYLON.Mesh('modelGroup', scene)

  // 全息模型材质
  const modelMaterial = new BABYLON.StandardMaterial('modelMaterial', scene)
  modelMaterial.diffuseColor = new BABYLON.Color3(0, 1, 0.616) // 亮绿
  modelMaterial.emissiveColor = new BABYLON.Color3(0, 1, 0.616) // 亮绿
  modelMaterial.alpha = 0.7
  modelMaterial.wireframe = true

  // 中心球体
  const centerSphere = BABYLON.MeshBuilder.CreateSphere('centerSphere', { diameter: 10 }, scene)
  centerSphere.material = modelMaterial
  centerSphere.parent = modelGroup

  // 环绕的圆环
  for (let i = 0; i < 3; i++) {
    const torus = BABYLON.MeshBuilder.CreateTorus(
      `torus${i}`,
      { diameter: 20 + i * 8, thickness: 0.5 },
      scene,
    )
    torus.material = modelMaterial
    torus.rotation.x = Math.PI / 2
    torus.rotation.z = (i / 3) * Math.PI * 2
    torus.parent = modelGroup

    torus.metadata = {
      rotationSpeed: (Math.random() - 0.5) * 0.01,
    }
  }

  // 连接线
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2
    const line = BABYLON.MeshBuilder.CreateCylinder(
      `line${i}`,
      { height: 15, diameter: 0.2, tessellation: 4 },
      scene,
    )
    line.material = modelMaterial
    line.position.y = 7.5
    line.rotation.y = angle
    line.parent = modelGroup
  }

  // 模型动画
  scene.registerBeforeRender(() => {
    const time = performance.now() * 0.001

    // 整体旋转
    modelGroup.rotation.y += 0.005

    // 子元素独立旋转
    modelGroup.getChildMeshes().forEach((mesh) => {
      if (mesh.metadata && mesh.metadata.rotationSpeed) {
        mesh.rotation.z += mesh.metadata.rotationSpeed
      }
    })

    // 呼吸效果
    const pulse = 0.5 + Math.sin(time * 1.5) * 0.2
    centerSphere.scaling.setAll(pulse)
  })
}

const createDynamicDataCharts = (scene: BABYLON.Scene) => {
  const chartCount = 6
  const charts: BABYLON.Mesh[] = []

  // 图表材质
  const chartMaterial = new BABYLON.StandardMaterial('chartMaterial', scene)
  chartMaterial.diffuseColor = new BABYLON.Color3(0, 1, 1) // 青色
  chartMaterial.emissiveColor = new BABYLON.Color3(0, 1, 0.616) // 亮绿
  chartMaterial.alpha = 0.6

  for (let i = 0; i < chartCount; i++) {
    const chartGroup = new BABYLON.Mesh(`chartGroup${i}`, scene)

    // 图表背景
    const chartBackground = BABYLON.MeshBuilder.CreatePlane(
      `chartBg${i}`,
      { width: 12, height: 8 },
      scene,
    )
    chartBackground.material = chartMaterial
    chartBackground.material.alpha = 0.1
    chartBackground.parent = chartGroup

    // 生成动态柱状图
    const barCount = 8
    const bars: BABYLON.Mesh[] = []
    for (let j = 0; j < barCount; j++) {
      const bar = BABYLON.MeshBuilder.CreateBox(
        `bar${i}_${j}`,
        { width: 1, height: 1, depth: 0.5 },
        scene,
      )
      bar.material = chartMaterial
      bar.position.x = (j - (barCount - 1) / 2) * 1.5
      bar.position.y = 0.5
      bar.position.z = 0.3
      bar.parent = chartGroup

      bar.metadata = {
        baseHeight: 1 + Math.random() * 4,
        pulseSpeed: 0.5 + Math.random() * 1,
        pulseOffset: Math.random() * Math.PI * 2,
      }

      bars.push(bar)
    }

    // 图表位置
    const angle = (i / chartCount) * Math.PI * 2
    const radius = 55
    const height = (Math.random() - 0.5) * 40

    chartGroup.position.x = Math.cos(angle) * radius
    chartGroup.position.y = height
    chartGroup.position.z = Math.sin(angle) * radius

    chartGroup.rotation.y = angle + Math.PI / 2
    chartGroup.rotation.x = (Math.random() - 0.5) * 0.1

    chartGroup.metadata = {
      originalAngle: angle,
      originalHeight: height,
      floatSpeed: 0.4 + Math.random() * 0.6,
      bars: bars,
    }

    charts.push(chartGroup)
  }

  // 图表动画
  scene.registerBeforeRender(() => {
    const time = performance.now() * 0.001

    charts.forEach((chart, index) => {
      const metadata = chart.metadata

      // 浮动效果
      chart.position.y =
        metadata.originalHeight + Math.sin(time * metadata.floatSpeed + index) * 1.5

      // 柱状图动态效果
      metadata.bars.forEach((bar: BABYLON.Mesh, barIndex: number) => {
        const barMeta = bar.metadata
        const pulse = Math.sin(time * barMeta.pulseSpeed + barMeta.pulseOffset + index) * 0.5
        bar.scaling.y = barMeta.baseHeight + pulse
        bar.position.y = bar.scaling.y / 2
      })
    })
  })
}

const createHolographicNodes = (scene: BABYLON.Scene) => {
  const nodeCount = 30
  const nodes: BABYLON.Mesh[] = []
  const connections: BABYLON.Mesh[] = []

  // 节点材质
  const nodeMaterial = new BABYLON.StandardMaterial('nodeMaterial', scene)
  nodeMaterial.diffuseColor = new BABYLON.Color3(0, 1, 0.616) // 亮绿
  nodeMaterial.emissiveColor = new BABYLON.Color3(0, 1, 0.616) // 亮绿
  nodeMaterial.alpha = 0.8

  // 连接线材质
  const connectionMaterial = new BABYLON.StandardMaterial('connectionMaterial', scene)
  connectionMaterial.diffuseColor = new BABYLON.Color3(0, 1, 1) // 青色
  connectionMaterial.emissiveColor = new BABYLON.Color3(0, 1, 1) // 青色
  connectionMaterial.alpha = 0.2

  // 创建节点
  for (let i = 0; i < nodeCount; i++) {
    // 随机位置
    const radius = 20 + Math.random() * 40
    const angle = Math.random() * Math.PI * 2
    const height = (Math.random() - 0.5) * 50

    const node = BABYLON.MeshBuilder.CreateSphere(
      `node${i}`,
      { diameter: 0.8 + Math.random() * 0.8 },
      scene,
    )
    node.material = nodeMaterial
    node.position = new BABYLON.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius)

    node.metadata = {
      originalPosition: node.position.clone(),
      pulseSpeed: 0.4 + Math.random() * 0.8,
      pulseOffset: Math.random() * Math.PI * 2,
      floatSpeed: 0.2 + Math.random() * 0.4,
      floatOffset: Math.random() * Math.PI * 2,
    }

    nodes.push(node)
  }

  // 创建连接线
  for (let i = 0; i < nodeCount; i++) {
    for (let j = i + 1; j < nodeCount; j++) {
      const distance = BABYLON.Vector3.Distance(nodes[i].position, nodes[j].position)
      // 只连接较近的节点
      if (distance < 25) {
        const connection = BABYLON.MeshBuilder.CreateLines(
          `connection${i}_${j}`,
          {
            points: [nodes[i].position, nodes[j].position],
            updatable: true,
          },
          scene,
        )
        connection.color = new BABYLON.Color3(0, 1, 1) // 青色
        connection.alpha = 0.2

        connection.metadata = {
          node1: nodes[i],
          node2: nodes[j],
          baseAlpha: 0.2,
          pulseSpeed: 0.3 + Math.random() * 0.6,
          pulseOffset: Math.random() * Math.PI * 2,
        }

        connections.push(connection)
      }
    }
  }

  // 节点和连接线动画
  scene.registerBeforeRender(() => {
    const time = performance.now() * 0.001

    // 节点动画
    nodes.forEach((node, index) => {
      const metadata = node.metadata

      // 呼吸效果
      const pulse = Math.sin(time * metadata.pulseSpeed + metadata.pulseOffset) * 0.5 + 0.5
      const scale = 0.8 + pulse * 0.4
      node.scaling.setAll(scale)
      node.material.alpha = 0.6 + pulse * 0.4

      // 轻微浮动
      node.position.y =
        metadata.originalPosition.y +
        Math.sin(time * metadata.floatSpeed + metadata.floatOffset) * 1.5
    })

    // 连接线动画
    connections.forEach((connection) => {
      const metadata = connection.metadata

      // 脉冲效果
      const pulse = Math.sin(time * metadata.pulseSpeed + metadata.pulseOffset) * 0.5 + 0.5
      connection.alpha = metadata.baseAlpha + pulse * 0.15

      // 更新连接线位置
      BABYLON.MeshBuilder.CreateLines(
        connection.name,
        {
          points: [metadata.node1.position, metadata.node2.position],
          instance: connection as any,
        },
        scene,
      )
    })
  })
}

const createHolographicParticles = (scene: BABYLON.Scene) => {
  const particleSystem = new BABYLON.ParticleSystem('hologramParticles', 300, scene)

  // 创建粒子纹理
  const particleTexture = new BABYLON.DynamicTexture('particleTexture', 64, scene)
  const ctx = particleTexture.getContext()
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(0, 255, 213, 1)') // 亮绿 #00ff9d
  gradient.addColorStop(0.5, 'rgba(0, 255, 255, 0.5)') // 透明蓝
  gradient.addColorStop(1, 'rgba(0, 255, 255, 0)') // 透明
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  particleTexture.update()

  particleSystem.particleTexture = particleTexture

  // 粒子系统配置
  particleSystem.emitter = new BABYLON.Vector3(0, 0, 0)
  particleSystem.minEmitBox = new BABYLON.Vector3(-50, -40, -50)
  particleSystem.maxEmitBox = new BABYLON.Vector3(50, 40, 50)

  particleSystem.color1 = new BABYLON.Color4(0, 1, 0.616, 1) // 亮绿
  particleSystem.color2 = new BABYLON.Color4(0, 1, 1, 1) // 青色
  particleSystem.colorDead = new BABYLON.Color4(0, 0, 0, 0)

  particleSystem.minSize = 0.5
  particleSystem.maxSize = 1.5

  particleSystem.minLifeTime = 5
  particleSystem.maxLifeTime = 10

  particleSystem.emitRate = 30

  particleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD

  particleSystem.direction1 = new BABYLON.Vector3(-0.3, 0.1, -0.3)
  particleSystem.direction2 = new BABYLON.Vector3(0.3, 0.3, 0.3)

  particleSystem.minEmitPower = 0.2
  particleSystem.maxEmitPower = 0.5

  particleSystem.updateSpeed = 0.01

  particleSystem.gravity = new BABYLON.Vector3(0, 0, 0)

  particleSystem.start()
}

onMounted(() => {
  createHolographicBackground()

  window.addEventListener('resize', () => {
    engine?.resize()
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', () => {
    engine?.resize()
  })

  engine?.dispose()
})
</script>

<style scoped>
.tech-grid-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100vh;
  z-index: -1;
  pointer-events: auto;
}
</style>
