# 验收报告

日期：2026-10-23　分支：`feat/p0`　环境：Ubuntu 26.04，Node 24.21，pnpm 10.34，Docker Compose（PostGIS 17-3.5、Redis 8.8.3、SeaweedFS 4.48）

状态说明：✅ 通过（附证据）· ⚠️ 部分通过或带条件 · ❌ 未通过或未验证

## 自动化测试结果

| 套件 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck` | ✅ 3 个包均无错误 |
| Lint | `pnpm lint` | ✅ 0 error、0 warning |
| 单元测试 | `pnpm test` | ✅ 4 个文件 38/38 通过（2026-10-25 复跑） |
| 集成测试（真实 PG/Redis/S3，测试替身 AI） | `pnpm test:integration` | ✅ 7 个文件 45/45 通过（2026-10-25 复跑，含后台设置、每日额度和实地踏勘） |
| E2E：试玩与接口安全（dev，390 / 1440） | `pnpm test:e2e --project=mobile-390 --project=desktop-1440` | ✅ 16/16 通过（2026-10-25 复跑，1.4 分钟） |
| E2E：真实模式流程（隔离的测试部署，360 / 1440） | `scripts/e2e-stack.sh start` 后运行 `--project=live-360 --project=live-1440` | ✅ 18/18 通过（2026-10-25 复跑，1.2 分钟）。上传辅助函数改为等到预览出现再继续：服务刚启动时，页面 hydration 完成前选的文件会丢失，导致偶发失败 |
| 生产构建 | `pnpm build` | ✅ |
| Docker 镜像 | `docker build .` | ✅ `tokyo-side-quest:a3ce939` 构建成功，所有 API 路由均为动态（ƒ） |
| 真实 AI 冒烟测试 | `pnpm ai:smoke` | ⚠️ 2026-10-25，`minimax-m3.1-flash`（OpenAI 兼容网关）：8/9 符合预期，1 次空响应记为技术错误。详见 ai-evaluation.md |

## §19.1 规则测试

| 编号 | 结果 | 证据 |
| --- | --- | --- |
| R01–R03 等级边界 | ✅ | `domain/grading.test.ts`：100/95/94/90/89/85/84/75/74/65/64/50/49/0 |
| R04 88/82/90/86 → 87 S | ✅ | grading.test.ts；集成和端到端测试中显示“S / 87” |
| R05 越界、缺维度、非整数 | ✅ | grading.test.ts（RangeError），`contracts/ai.ts` 的 Zod 校验拒绝 |
| R06 不匹配或不确定时不评分、不出 D | ✅ | 集成测试 “mismatched photo never gets a rating”；端到端测试检查不匹配页没有 `.grade` 元素 |
| R07 距离正好在边界 | ✅ | location.test.ts “passes exactly on the radius” |
| R08 距离近但精度不合格 | ✅ | location.test.ts；集成测试 `LOCATION_INACCURATE` |
| R09 读数过期、非法坐标、经纬倒置 | ✅ | location.test.ts（stale / clock-ahead / invalid / swapped） |
| R10 并发、重复请求、重复消费任务 | ✅ | 集成测试 “duplicate job delivery…”；并发定位打卡同一节点只记录 1 次进度 |

## §19.2 API、权限与持久化

| 编号 | 结果 | 证据 |
| --- | --- | --- |
| I01 读取他人的照片、attempt、海报 | ✅ | 集成测试（attempt、poster）；`readOwnPhoto` 做所有权校验 |
| I02 普通用户调用复核接口 | ✅ | `api-security.spec.ts` 返回 401；集成测试确认访客令牌不能当管理员令牌 |
| I03 伪造等级、distance、visitorId | ✅ | `api-security.spec.ts`：严格 schema 返回 400 |
| I04 同幂等键不同请求 | ✅ | `api-security.spec.ts` 返回 409 `IDEMPOTENCY_CONFLICT`；相同请求重放返回原响应 |
| I05 事务提交后队列暂时不可用 | ✅ | outbox 与业务写入在同一事务；集成测试 “outbox rows publish… stable job ids” |
| I06 匹配后评分失败 | ✅ | 集成测试 “rating failure keeps the check-in; retry re-runs rating only” |
| I07 Worker 重启、同一任务重复执行 | ✅ | 集成测试：并发和重复执行后，打卡、评分、印章、核验记录各 1 条 |
| I08 标准化后的 EXIF | ✅ | images.test.ts：GPS 和 EXIF 被移除、方向已校正 |
| I09 伪造 MIME、超限或异常图片 | ✅ | images.test.ts：HTML 伪装、GIF、超过 15 MB 都被拒绝 |
| I10 删除期间 Worker 返回结果 | ✅ | deletion.test.ts：返回 `skipped: cancelled`，没有打卡、没有印章，存储中的文件已删除 |
| I11 同一照片重复提交 | ✅ | 集成测试：同一上下文返回原 attempt；换上下文时复用评估，只调用 1 次 AI |
| I12 用手动地图坐标申请真实到访 | ✅ | 手动选街区只用于浏览；模拟定位在真实模式下返回 403（集成测试），请求 schema 也没有“手动位置”这类字段 |
| I13 试玩与真实数据隔离 | ✅ | 集成测试；端到端测试中试玩后真实记录为 0 |
| I14 撤销分享、删除封面照片 | ✅ | posters.test.ts、deletion.test.ts；端到端测试在隐私窗口中撤销后，页面和图片均返回 404 |
| I15 没有 AI Key 时提交真实照片 | ✅ | `api-security.spec.ts` 返回 503 `AI_NOT_CONFIGURED`；集成测试确认不会创建 attempt |

## §19.3 端到端测试

| 场景 | 结果 | 测试 |
| --- | --- | --- |
| 首页 → 选择街区 → 找到地点 → 详情 | ✅ | live: location denied… |
| 拒绝定位 → 手动选街区 → 浏览 → 进入拍照 | ✅ | live: location denied… |
| 提交照片 → 显示阶段 → 刷新 → 找回同一结果 | ✅ | live: submit photo → … |
| 匹配 → S 等级 → 生成票根 → 下载 PNG | ✅ | live（测试替身）+ dev: demo poster 下载并校验 PNG 文件头 |
| 不匹配 → 说明原因 → 重拍 | ✅ | live: mismatched… |
| 无法确认 → 申请复核 → 管理员通过 → 接续评分 | ✅ | live: uncertain → review… |
| 领取故事 → 完成全部节点 → 结局，完成章只发一次 | ✅ | live: story…（真实模式，定位完成）；dev: demo |
| 中途结束 → 恢复 → 进度保留 | ✅ | live: story… |
| 定位打卡出现在到访足迹；仅照片打卡单独标注 | ✅ | live: device location check-in…；结果页显示“照片地点匹配 · 未核验到访” |
| 创建分享 → 隐私窗口访问 → 撤销 → 失效 | ✅ | live: submit photo → … |
| 360 / 390 / 1440 px 无遮挡、无横向溢出 | ✅ | live: core pages have no horizontal overflow（360 和 1440）；dev 项目跑 390 |

## §20 最终验收清单

### 产品与体验
- ✅ 首屏讲清玩法，可以真实进入附近探索或试玩
- ✅ 不注册也能保存本设备记录
- ⚠️ 定位允许、拒绝、超时、精度不足都有后续流程（自动化测试用模拟的地理位置验证；**真机 HTTPS 尚未验证**）
- ✅ 定位和拍照是两种独立方式
- ✅ 地点核验和摄影评价在文案、状态和数据上分开
- ✅ 七档等级通过边界测试
- ✅ 重拍不覆盖历史；相同图片相同版本不重复评分
- ✅ 任务可恢复，奖励幂等，试玩与真实隔离

### 完整作品
- ⚠️ 6 个真实地点档案，坐标和资料都有依据（**桌面核对，未实地核验**；3 个地点只开放定位）
- ✅ 一条完整原创故事：开场、4 个主要节点、结局
- ❌ 真实 AI 核验与评分冒烟测试（等待 AI Key）
- ✅ 数据持久化、队列、Worker、存储可复现运行
- ✅ 海报可下载，分享可创建、可撤销
- ✅ 管理后台有真实权限校验和复核记录
- ✅ 没有 Key、依赖故障时不产生虚假成功（I15、技术错误路径测试）

### 设计、东京文化与宣传
- ✅ 票根、线路、任务、印章使用统一视觉语言
- ✅ 地点文化介绍有来源；原创故事标注为虚构
- ✅ 没有把生成图当作核验参考（全部为 Commons 实拍照片，上传接口拒绝 AI 生成图）
- ✅ 宣传首页、主海报、分享预览图、个人票根模板（`apps/web/public/brand/`）
- ⚠️ 手机、桌面、键盘和基本无障碍：语义化按钮、可见焦点、44px 触控目标、状态播报、尊重减少动效。**尚未用屏幕阅读器人工测试**

### 交付可信度
- ✅ 运行命令、环境配置、迁移、种子、测试和部署说明
- ✅ 本报告记录了实际执行的测试；真机和真实模型的证据**尚缺**
- ✅ 已区分通过、未验证和已知限制
- ✅ 没有临时密钥（`.env` 已被忽略；`.env.example` 不含密钥）

## 已知限制与用户可见影响

| 限制 | 用户可见影响 | 解决方式 |
| --- | --- | --- |
| 未配置 AI | 照片核验入口显示“暂未开通”；试玩不受影响 | 配置 Key 后运行 `pnpm ai:smoke` |
| 地图 key 只允许演示地址 | 换域名后地图加载失败（403），列表正常 | 在 MapTiler 后台更新 Allowed HTTP Origins |
| 坐标和半径未实地校准 | 现场可能出现“靠近边界”或误判 | 实地校准后在后台修改并发布新版本 |
| 参考图偏旧或不足 | 夕やけだんだん、よみせ通り、根津神社只能定位打卡；其余 3 处可能出现 uncertain | 实地补拍并记录授权 |
| 没有真机 HTTPS 验证 | — | 部署 HTTPS 后用手机验证 |
| 没有正式账号和跨设备同步 | 清除浏览器数据会丢失记录（页面已提示） | 属于 P1 |
| 构建警告：海报字体路径在运行时拼接，Turbopack 会追踪整个项目 | 无；镜像内容约 424MB，略大 | 把字体路径改成静态子目录，或加 `turbopackIgnore` 并在 Dockerfile 显式复制字体 |
