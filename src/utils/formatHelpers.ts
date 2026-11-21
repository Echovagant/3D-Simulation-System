/**
 * 格式化文件大小（字节 -> KB, MB, GB）
 * @param bytes 文件大小（字节）
 * @param decimals 保留的小数位数
 * @returns 格式化后的文件大小字符串
 */
export const formatFileSize = (bytes: number, decimals: number = 2): string => {
  // 负数会让 Math.log 返回 NaN，非法数字同理——一律退化成 0 Bytes
  if (!Number.isFinite(bytes) || bytes < 0) return '0 Bytes';
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * 格式化日期
 * @param dateString 日期字符串
 * @param options 格式化选项
 * @returns 格式化后的日期字符串
 */
export const formatDate = (
  dateString: string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }
): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, options);
};

/**
 * 格式化数字（添加千位分隔符）
 * @param num 要格式化的数字
 * @returns 格式化后的数字字符串
 */
export const formatNumber = (num: number): string => {
  return new Intl.NumberFormat().format(num);
};
    