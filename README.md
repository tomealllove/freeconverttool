# 在线文件工具站 · 使用说明

15 个纯前端文件处理页面 + 1 个首页入口，零后端，所有文件处理都在浏览器本地完成。

## 本地预览方式

### 方式一：直接双击（最简单）
双击打开 `index.html`，或地址栏输入：

```
C:\Users\Administrator\WorkBuddy\2026-09-08-23-24-25\file-tools\index.html
```

### 方式二：本地服务器（推荐，兼容性最佳）
在本目录打开终端，任选一条：

```bash
python -m http.server 8000
# 或
npx serve .
```

然后浏览器访问 `http://localhost:8000`。

**为什么推荐方式二**：以 `file://` 直接打开时，个别浏览器会拦截跨域 Worker，导致「图片转 GIF」的 gif.js 无法启用（其余功能不受影响，PDF 相关页面已内置 Blob 兜底方案）。用 http 方式打开则全部正常。

## 目录结构

```
file-tools/
├── index.html                  首页 · 工具总览
├── assets/
│   ├── css/style.css           全站统一样式（含侧栏布局与组件）
│   └── js/
│       ├── common.js           公共层：侧栏导航、Toast、进度、拖拽上传、ZIP、Canvas、pdf.js 封装
│       └── pages/              15 个页面各自的逻辑
└── 15 个工具页面 .html
```

## 15 个页面

| 分类 | 页面 | 文件 | 关键依赖 |
| --- | --- | --- | --- |
| 图片工具 | 图片格式化 | img-convert.html | Canvas |
| | 图片转 PDF | img-to-pdf.html | pdf-lib |
| | 图片转 GIF | img-to-gif.html | gif.js |
| | 图片压缩 | img-compress.html | Canvas |
| PDF 工具 | PDF 转 Word | pdf-to-word.html | pdf.js + 手写 OOXML |
| | PDF 合并拆分 | pdf-merge.html | pdf-lib |
| | PDF 压缩 | pdf-compress.html | pdf.js + pdf-lib |
| | PDF 转图片 | pdf-to-img.html | pdf.js |
| 转换工具 | 音频格式转换 | audio-convert.html | WebAudio + lamejs（+ffmpeg.wasm 高级模式） |
| | 视频格式互转 | video-convert.html | ffmpeg.wasm（+ 原生抽帧） |
| | 电子书格式互转 | ebook-convert.html | JSZip + pdf-lib |
| 汉字转换 | 繁简汉字转换 | zh-convert.html | opencc-js |
| | 汉字大小写转换 | han-case.html | 纯算法 |
| 证件照与码 | 证件照生成 | id-photo.html | Canvas（+MediaPipe 可选 AI 抠图） |
| | 二维码生成 | qrcode.html | qrcode-generator |

## 依赖说明

所有第三方库均通过 CDN 按需加载（jsDelivr / cdnjs / unpkg），**首次使用某功能需要联网**。ZIP 打包内置了不依赖网络的兜底实现。

| 库 | 大小量级 | 用到它的页面 |
| --- | --- | --- |
| pdf.js | ~1MB | PDF 转 Word / 转图片 / 压缩 |
| pdf-lib | ~1MB | 图片转 PDF、PDF 合并拆分、PDF 压缩、电子书转 PDF |
| JSZip | ~100KB | 打包下载、EPUB 读写 |
| gif.js | ~30KB + worker | 图片转 GIF |
| lamejs | ~150KB | 音频转 MP3 |
| ffmpeg.wasm | ~30MB（懒加载） | 音频高级模式、视频转码（点击后才下载） |
| opencc-js | ~1MB 词库 | 繁简转换 |
| qrcode-generator | ~20KB | 二维码生成 |
| MediaPipe | ~2MB 模型（懒加载，失败自动回退） | 证件照 AI 抠图 |

## 已知边界（页面内也有提示）

- **PDF 转 Word**：适合文本型 PDF；多栏、表格、图文混排还原度有限；扫描件没有文本层，本工具不做 OCR。
- **PDF 压缩**：「轻度」只重写结构与元数据；「重印」会把文字变成图片（不可选中、不可搜索）。
- **MOBI / AZW3**：私有格式，前端没有可用解析库，页面会明确拒绝并建议先用 Calibre 转 EPUB。
- **音频**：浏览器原生没有 AAC / FLAC 编码器，这两个格式需走 ffmpeg.wasm 高级模式。
- **音频「保持原样」**：采样率选「保持原样」时，WAV 等无损格式会**精确保留**源文件采样率；MP3 等压缩格式因浏览器不暴露原始采样率，按解码所得采样率输出（指定具体数值可精确控制）。
- **视频**：ffmpeg.wasm 无硬件加速，仅适合短视频；长视频请用专业工具。
- **证件照**：AI 抠图需联网加载模型，失败时自动回退为纯色容差抠图。
