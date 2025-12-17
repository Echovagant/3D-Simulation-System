// 保留图表配置项和实例的类型定义（继续用于类型约束）
interface EChartsOption {
  title?: {
    text?: string;
    left?: string;
    textStyle?: {
      fontSize?: number;
    };
  };
  legend?: {
    data?: string[];
    top?: string | number;
    left?: string;
  };
  grid?: {
    left?: string | number;
    right?: string | number;
    bottom?: string | number;
    top?: string | number;
    containLabel?: boolean;
  };
  xAxis?: {
    type?: 'category';
    data?: string[];
    gridIndex?: number;
    axisLine?: { show?: boolean };
    axisTick?: { show?: boolean };
    splitLine?: {
      show?: boolean;
      lineStyle?: {
        color?: string;
      };
    };
  };
  yAxis?: {
    type?: 'value';
    name?: string;
    splitLine?: {
      show?: boolean;
      lineStyle?: {
        color?: string;
      };
    };
    min?: number;
    max?: number;
    axisLine?: { show?: boolean };
    axisTick?: { show?: boolean };
  };
  series?: Array<{
    name?: string;
    type?: 'bar';
    data?: number[];
    barWidth?: string;
    itemStyle?: {
      color?: string;
    };
  }>;
}

interface EChartsInstance {
  setOption(option: EChartsOption): void;
  resize(): void;
  dispose(): void;
}

// 关键修改：声明全局 window.echarts 变量
declare global {
  interface Window {
    echarts: {
      init: (dom: HTMLElement) => EChartsInstance;
    };
  }
}

// 确保文件被识别为模块（避免全局声明冲突）
export {};
