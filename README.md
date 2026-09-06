# Neon Pulse

Neon Pulse 是一款可直接在浏览器运行的四键下落式音乐节奏游戏。项目使用 React、TypeScript、Vite、Web Audio API 和 Vitest；内置 `Chromatic Run` 与 `Midnight Arcade` 两首原创电子曲、四首经典交响主题的原创合成改编，并为五首华语流行歌曲提供合规的浏览器本地音频导入入口。公开构建不包含商业歌曲录音、歌词、第三方 MIDI、唱片封面或艺人图片。

## 安装与运行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

打开终端显示的地址，默认是 `http://127.0.0.1:5173/`。四条轨道默认使用 `D`、`F`、`J`、`K`，可在设置中重新绑定，也支持鼠标点击与手机多点触控。`Esc` 暂停；全屏只能由玩家主动点击界面按钮进入。首次打开会出现四步本地教程，可跳过，并可在“玩法”设置中重新打开。

首次访问默认选择 Easy。之后每次切歌或切换难度都会写入版本化的 `neon-pulse:selection`；旧版没有该键时，会从最近一次正式成绩恢复歌曲与难度，成绩、校准参数和键位均不会被覆盖。

## 检查与生产构建

```bash
npm run format:check  # Prettier 格式检查
npm run typecheck     # TypeScript 类型检查
npm test              # 自动化测试与 1,600 音符压力测试
npm run build         # 类型检查并生成 dist/
npm run preview       # 本地预览生产构建
```

Vite 的 `base` 使用相对路径 `./`，因此生产资源既能部署在网站根目录，也能部署在子目录。

## 游戏与同步规则

- 判定窗口：Perfect ±45ms、Great ±90ms、Good ±140ms，之后为 Miss。
- Tap 在判定线按下；Hold 先命中头部，再持续按住至尾部。提前松开会中断连击；暂停与失焦不会直接判定 Hold 失败，继续后有 250ms 重新按住宽限。
- 不处理键盘自动重复；每个键盘按下、鼠标指针或触摸指针都拥有独立输入状态，多点触控可以同时按住多轨。
- 所有音符位置和判定都由 `AudioContext.currentTime` 计算。`requestAnimationFrame` 只负责读取音频时钟与绘制，不使用普通计时器累计游戏时间。
- 音乐采用约 450ms 的短窗口预调度，长曲目不会一次创建全部 `AudioNode`。谱面查询使用二分时间索引与按轨道游标，每帧只处理当前可见和待判定音符。
- 每首歌曲都可试听前 10 秒。试听、正式演奏、延迟校准和教程节拍互斥；切歌、失焦、退出弹窗或组件卸载会立即停止旧音频并清理调度任务。
- “标准模式”在生命值归零时结束并保存正式成绩；“练习模式”即使生命值归零也会继续到曲末，照常统计判定、连击与偏差，但绝不写入最高分、Clear、FC 或 AP。
- 每个 Tap 或 Hold 对象只产生一次 Perfect/Great/Good/Miss 主判定，因此四档合计始终等于谱面音符数。Hold 尾部以 `Hold Complete/Break` 独立统计，不会重复增加主判定或 Miss。
- 每张谱面按最大计分单位标准化为满分 1,000,000；Hold 头部与尾部各占一个计分单位，但连击只按音符对象增长。

正 Offset 会让谱面和判定相对音乐更晚，负 Offset 会让它们更早。手动滑块和自动校准结果都以 5ms 为步长。自动校准包含 4 个预热拍和 16 个采样拍，过滤明显异常值后使用中位数与 MAD 进行稳健估计。

设置以版本 3 结构保存在 `neon-pulse:settings`，并兼容旧的速度/Offset 设置。判定偏移与视觉偏移相互独立；主音量、音乐、打击音、特效强度、震屏、触觉反馈和四轨键位也会保存在本机。教程完成状态单独保存在 `neon-pulse:tutorial:v1`，不会写入正式成绩。现有成绩仍按“歌曲 + 难度”使用原键名保存；未来完成的本地音频谱面会按“歌曲 + 音频版本 + 难度”隔离记录，不会混用不同版本。旧记录会无损补齐 Clear 字段，并继续保留最高分、准确率、最大连击、最佳评级、FC 与 AP。放弃本局不会保存成绩，也不会把剩余音符强制补记为 Miss。

选中难度时，界面会直接从 JSON 谱面计算音符总数、Tap/Hold、平均与峰值 NPS、双押比例、最长连续换手、同轨连点和 Hold 期间的其他输入量。开发环境还会严格检查 6 首可玩歌曲与 18 套正式谱面的唯一 ID、时间顺序、轨道范围、重复输入、Hold 重叠、歌曲边界、主判定总数和 1,000,000 理论满分；同时检查五首本地歌曲的 15 个模板没有伪造音符或推测音频数据。错误信息包含歌曲、难度和音符索引。

## 源码结构

- `src/songs/catalog.ts`：歌曲清单与合成配置元数据。
- `src/charts/*.json`：Easy、Normal、Hard 独立 JSON 谱面。
- `src/charts/parseChart.ts`：谱面加载、排序、字段校验与轨道索引构建。
- `src/charts/validateCatalog.ts`：开发环境的全曲库严格校验与理论满分验证。
- `src/audio/SynthEngine.ts`：Web Audio 合成、试听、教程节拍、音量总线、暂停恢复与校准节拍。
- `src/audio/LocalAudioLibrary.ts`：本地文件校验、内存解码缓存、对象 URL 生命周期和试听接入。
- `src/audio/scheduler.ts`：基于音频时钟的短窗口调度游标。
- `src/game/chartRuntime.ts`：Tap/Hold 状态机、漏击游标、暂停与重新按住逻辑。
- `src/game/chartIndex.ts`：可见时间窗口二分索引。
- `src/game/scoring.ts`：判定、连击、标准化计分、准确率、评级与时间分布纯函数。
- `src/game/calibration.ts`：自动校准的稳健统计算法。
- `src/game/settings.ts`、`src/game/records.ts`：版本化设置与成绩持久化。
- `src/game/selection.ts`：首次 Easy、选曲记忆与旧玩家最近成绩迁移。
- `src/game/localSongPreferences.ts`：每首本地歌曲的版本标签、独立偏移和上次检测时长；不保存音频或文件名。
- `src/game/audioActivity.ts`：试听、校准与教程音频的互斥和统一清理。
- `src/game/displayState.ts`：待机、演奏、暂停与结算的展示语义。
- `src/components/`：难度、校准、教程、确认和结算界面。
- `src/App.tsx`：演奏会话、输入协调、音频时钟渲染循环与页面状态。

## 添加原创歌曲

1. 在 `src/songs/catalog.ts` 增加歌曲元数据。`id` 必须唯一，`duration` 以秒为单位；`category` 选择 `original`、`classical` 或 `mandopop`，`synthProfile` 选择现有合成风格，也可以按第 3 步新增。
2. 为每个难度在 `src/charts/` 创建独立 JSON，并在 `src/charts/index.ts` 注册。格式如下：

```json
{
  "id": "my-song-normal",
  "songId": "my-song",
  "difficulty": "normal",
  "level": 6,
  "description": "围绕主旋律安排交替、双押与两段渐进 Hold。",
  "notes": [
    { "id": "n001", "time": 1.875, "lane": 0, "type": "tap" },
    {
      "id": "n002",
      "time": 2.34375,
      "lane": 1,
      "type": "hold",
      "duration": 0.9375
    }
  ]
}
```

`time` 和 Hold 的 `duration` 均为秒；`lane` 只能是 `0`、`1`、`2`、`3`，对应 `D`、`F`、`J`、`K`；`type` 只能是 `tap` 或 `hold`。每个音符 `id` 必须唯一，同一轨道不能在 Hold 持续期间放置另一个音符，音符结束时间不能超过歌曲时长。加载器会自动排序未排序的音符并给出提示；错误字段会显示清晰错误，不会让游戏崩溃。

3. 如需不同编曲，在 `SynthEngine` 中按 `synthProfile` 添加新的原创合成调度器，继续使用同一绝对 `AudioContext` 时间与短窗口游标。

内置 `Chromatic Run`、`Midnight Arcade` 及其谱面为本项目的程序化原创内容，无需密钥或外部版权资源。

## 经典交响曲目与音乐许可

“经典交响”分类只使用已进入公版的作品主题。本项目没有下载、打包或播放商业录音、流媒体音频、人声采样或第三方 MIDI；旋律轮廓依据下列公版总谱人工编码，并以 Web Audio 振荡器、包络、滤波、立体声声像、算法混响和程序化定音鼓重新编配。页面统一标注“公版作品 · 本站原创合成改编”，音频实现和谱面数据属于本项目自己的程序化改编。

- 贝多芬《第五交响曲》第一乐章，作品 67：72 秒，108 BPM。参考 [IMSLP 公版总谱索引](https://imslp.org/wiki/Symphony_No.5_%28Beethoven%2C_Ludwig_van%29)。
- 莫扎特《第四十交响曲》第一乐章，K.550：68 秒，132 BPM。参考 [IMSLP 公版总谱索引](https://imslp.org/wiki/Symphony_No.40_%28Mozart%2C_Wolfgang_Amadeus%29)。
- 德沃夏克《第九交响曲“自新大陆”》第四乐章，作品 95：80 秒，96 BPM。参考 [IMSLP 公版总谱索引](https://imslp.org/wiki/Symphony_No.9%2C_Op.95_%28Dvo%C5%99%C3%A1k%2C_Anton%C3%ADn%29)。
- 贝多芬《第九交响曲》第四乐章“欢乐颂”主题，作品 125：78 秒，100 BPM。参考 [IMSLP 公版总谱索引](https://imslp.org/wiki/Ludwig_van_Beethoven%3A_Symphony_No.9%2C_Op.125_%28Beethoven%2C_Ludwig_van%29)。本改编不使用人声。

IMSLP 各文件可能带有地区性公版提示；本项目只参考作品本身及页面中标记为 Public Domain 的历史总谱，不再分发原始扫描文件。`scripts/generate-classical-charts.mjs` 保存四首曲目的节奏网格与谱面编排规则，可重新生成 12 个 JSON 谱面；生成后的 JSON 仍会经过与手写谱面相同的排序、轨道、Hold 重叠和歌曲边界校验。

## 华语流行、本地音频与版权

《晴天》《七里香》《夜曲》《稻香》《青花瓷》及相关商业录音仍受版权保护。仓库审计没有发现用户提供且明确允许网页公开分发的音频，因此本项目采用“本地音乐导入模式”：

- GitHub 仓库和生产构建不包含这些歌曲的录音、伴奏、分轨、翻唱、MIDI、完整歌词、专辑封面、MV 截图或艺人照片。
- 玩家只能从自己的设备选择有权使用的本地音频。代码通过 `File.arrayBuffer()` 和 `AudioContext.decodeAudioData()` 在浏览器内解码；不调用上传接口，不发送文件网络请求，也不把音频写入 `localStorage`。
- 解码后的 `AudioBuffer` 最多缓存两首，替换、淘汰、切换生命周期和组件卸载都会停止音源并释放对象 URL。刷新页面后浏览器不会继续持有文件，界面会要求重新选择。
- `src/songs/music-licenses.json` 的 `bundledAudio` 为空，明确记录当前没有获准公开分发的内置商业录音。
- `src/songs/mandopop-chart-templates.json` 只记录 `audioVersion`、`expectedDuration`、`firstBeatOffsetMs`、`previewStart`、`previewDuration`、`tempoMap` 和三档制谱方向。未经实际匹配音频测量的 BPM、时长、第一拍和速度表保持为空，不凭记忆填写。
- 当前 15 个 Easy/Normal/Hard 项目均明确标记为 `draft` 且 `notes` 为空，不计入 18 套正式可玩谱面。导入文件后可试听 10 秒并保存歌曲独立偏移，但正式开始按钮仍会保持禁用，直到取得合法匹配版本、测量同步参数并完成逐拍制谱。

完成正式谱面前，需要在合法音频副本上逐首测量准确时长、第一拍偏移、BPM/变速和试听起点，再按模板方向制作音符并通过现有谱面验证器。音符数据只能表达演奏节奏，不得加入歌词或能够还原完整旋律的音高序列。
