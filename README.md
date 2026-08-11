# 镜匣（SceneFrame）

SillyTavern 的移动端优先剧情生图扩展。

## 项目原则

- 独立实现，不复制或改写其他插件源码。
- 仅参考公开的产品功能与交互思路。
- 首版支持 NovelAI 与 A1111/Forge。
- 以 `<image>...</image>` 为默认触发格式。
- 重点解决剧情图片的角色、场景与镜头连续性。
- API Key 只保存在本地扩展设置，不进入 Git、聊天记录或日志。

## 开发阶段

- [ ] v0.1：消息监听、image 块解析、任务队列、NAI/A1111 适配器
- [ ] v0.1：移动端悬浮球、底部抽屉、提示词预览与编辑
- [ ] v0.1：IndexedDB 图片缓存、任务去重、消息绑定
- [ ] v0.2：ComfyUI API workflow
- [ ] v0.2：连续性快照与角色/场景锁定

## 导入测试

本项目当前是第三方扩展原型，不是预设 JSON。解压后把整个 `scene-frame` 文件夹放到：

```text
SillyTavern/public/scripts/extensions/third-party/scene-frame/
```

然后重启酒馆，在扩展设置中启用 `SceneFrame 镜匣`。打开聊天后，右下角应出现 🖼️ 悬浮球。

默认触发格式：

```html
<image>1girl, solo, long hair, cafe</image>
```

首次测试请保持“自动：关”，确认图片块后手动点击“生成”。

## 本地开发

项目代码位于当前目录。开发过程中的密钥、个人配置和测试图片禁止提交。

## GitHub

建议使用 GitHub Private repository：`scene-frame-st`。

仓库设置建议：

- Visibility：Private
- 默认分支：`main`
- 开启 Issues 与 Discussions
- 开启 Actions，但不要在仓库变量中保存个人 API Key
- 使用 `.env.local` 或 SillyTavern 本地设置保存密钥
