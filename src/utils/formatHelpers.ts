import DOMPurify from 'dompurify';

/**
 * 格式化文件大小（字节 -> KB, MB, GB）
 * @param bytes 文件大小（字节）
 * @param decimals 保留的小数位数
 * @returns 格式化后的文件大小字符串
 */
export const formatFileSize = (bytes: number, decimals: number = 2): string => {
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

/**
 * 净化HTML内容，防止XSS攻击
 * @param html 原始HTML字符串
 * @returns 净化后的HTML字符串
 */
export const sanitizeHtml = (html: string): string => {
  // 配置DOMPurify允许常见的Markdown生成的标签和属性
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['pre', 'code', 'kbd', 'samp', 'var'],
    ADD_ATTR: ['class', 'id', 'style', 'data-language'],
    ALLOW_UNKNOWN_PROTOCOLS: true
  });
};

/**
 * 格式化文档标题，用于导航和显示
 * @param title 原始标题
 * @returns 格式化后的标题
 */
export const formatDocTitle = (title: string): string => {
  if (!title) return '';

  // 首字母大写，替换连字符为空格
  return title
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * 解析文档路径，提取章节信息
 * @param path 文档路径
 * @returns 章节信息对象
 */
export const parseDocPath = (path: string): { category: string; name: string } => {
  const parts = path.split('/');
  return {
    category: parts[0] || '',
    name: parts[1] || ''
  };
};
    