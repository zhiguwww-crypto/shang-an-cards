# 账号体系与多设备云同步

面向「上岸常识刷刷刷」网页版的登录与进度同步实现说明。目标：换设备登录后进度自动接续。

## 一、你需要提前准备的事项

| 项目 | 说明 | 现状 |
|---|---|---|
| 服务器 / 数据库 | **不需要自建**。使用 WorkBuddy 云服务（托管 Postgres + 认证），已在本应用开通 | ✅ 已开通（billingStatus=normal） |
| 域名 | 云服务按 **Origin 精确匹配**授权，必须用已发布的域名访问（`app.workbuddy.host` 子域），localhost / file:// 无法登录 | ✅ 沿用现有发布域名 |
| 邮箱验证码通道 | 邮箱验证码由平台邮件通道发送，无需你配置 SMTP | ✅ 随云服务提供 |
| 短信验证码通道 | 手机号验证码依赖平台短信通道与额度；未开通时该入口会返回错误 | ⚠️ 需在管理面板确认短信额度，否则建议先用邮箱 |
| 账号昵称 / 头像 | 用于「设备管理」里的展示，取自登录用户资料，缺省时留空 | 自动 |
| 隐私政策 / 用户协议 | 登录后保存的是学习进度（答题记录、对错、时长），不含身份证、支付等敏感信息；上线前建议补一份简短隐私说明 | ⚠️ 建议补 |
| 计费 | 云服务按平台额度计费，注册用户数与数据量增长时留意额度 | 按平台面板 |

## 二、整体实现思路

```
浏览器（单文件网页）
  ├─ CDN 加载 @tencent-ai/workbuddy-cloud-sdk（global WorkBuddyCloud）
  ├─ cloud.auth      登录 / 注册 / 找回密码 / 会话刷新
  └─ cloud.database  PostgREST：user_progress（进度快照）+ sync_sessions（设备列表）
        │  publishableKey + 当前会话（SDK 自动附加，前端不碰 token）
        ▼
WorkBuddy 云服务（托管 Postgres + RLS）
```

### 1. 数据模型

`user_progress`（每用户一行，进度整体快照）

| 列 | 类型 | 说明 |
|---|---|---|
| `owner_id` | text | 主键，`DEFAULT auth.uid()`，客户端**从不发送** |
| `payload` | jsonb | 完整进度：`cards / log / time / ans / stars / fixes / settings` |
| `rev` | bigint | 乐观锁版本号，每次写 +1 |
| `updated_at` | timestamptz | 最后写入时间 |

`sync_sessions`（多端会话可见性）

| 列 | 说明 |
|---|---|
| `owner_id` + `device_id` | 唯一约束，一台设备一行 |
| `label` / `platform` | 设备与浏览器标识（iPhone·Safari 等） |
| `last_seen` | 最近一次同步时间 |

### 2. 同步流程（拉取 → 合并 → 推送）

1. **登录成功 / 打开页面（已登录）/ 每 5 分钟 / 切后台 / 评分后 8 秒防抖** 触发 `syncNow()`
2. `pull`：读自己的 `user_progress` 行
3. `merge(local, remote)`：**按字段合并**，不是简单覆盖
   - `cards[id]`：`lv / seen / right / wrong / fuzzy / streak` 取大，`due` 取晚，`born` 取早，`master` 取或
   - `log / time`：按日期取大；`ans`：按日期取 `n` 较大的一方（`ok` 不超过 `n`）
   - `stars`：并集；`fixes`：按 `from+at+note` 去重并集
   - `settings`：优先本机（避免一端误改主题覆盖另一端）
4. `push`：`update ... set rev = rev+1 where rev = 本地已知版本`
   - 影响 0 行 = 别的设备刚写过 → 重新 pull → 再 merge → 重试（最多 2 次）
   - 首次无记录时 `insert`，撞唯一键（23505）自动转 update
5. 成功：清 dirty 标记、刷新「上次同步」、更新 `sync_sessions.last_seen`

### 3. 登录方式

| 入口 | 流程 |
|---|---|
| **验证码**（邮箱/手机） | `sendOtp` 发码 → 保存 `verificationId + isExistingUser` → `verifyOtp` 校验。新用户验证后自动建号（可同时设密码） |
| **密码登录** | `signInWithPassword({ email 或 phone, password })` |
| **找回密码** | `resetPasswordForEmail(email)` → 邮件验证码 → `updateUser({ nonce, password })`，成功后自动登录 |
| **修改密码**（已登录） | `resetPasswordForOld({ oldPassword, newPassword })` |

### 4. 多端会话管理

- SDK 负责 Token：access token + `wbrt_` 刷新句柄，自动刷新、跨刷新保持；前端只调用 `getSession()` / `onAuthStateChange`
- 每台设备登录后写入一行 `sync_sessions`，数据页「设备管理」可查看最近活跃时间、移除旧设备记录
- **限制（如实说明）**：SDK 未开放「远程强制下线」接口，移除记录只是清理列表；要让某台设备失效，需在该设备上「退出登录」。密码重置建议作为兜底手段

### 5. 与离线/小工具的关系

- 未登录：功能完全可用，进度照旧只存本机（不降级、不阻塞）
- 登录后：本机进度自动并入云端，**不丢本机数据**
- 小红书小工具包（容器不联网）：构建时整段剔除同步模块与登录入口，产物内 0 处相关引用

## 三、安全性注意事项

1. **权限在数据库，不在前端**：`user_progress` / `sync_sessions` 均启用 RLS，策略为 `owner_id = auth.uid()`（INSERT/UPDATE 带 `WITH CHECK`，防止伪造 owner 把数据写给他人）。前端不做「是不是我的」判断，仅用于界面展示。
2. **客户端从不发送 `owner_id`**：由 `DEFAULT auth.uid()` 服务端填充；显式传 `null` 反而会覆盖默认值并被拒绝。
3. **publishableKey 不是密钥**：它只标识应用、本身不含权限；真正的边界是「登录会话 + RLS + 域名 Origin 精确匹配」。切勿在代码里放任何管理级密钥。
4. **Token 不落地到我们自己的存储**：由 SDK 管理；不写日志、不放 URL、不导出到进度 JSON。
5. **错误不泄露账号信息**：登录失败统一提示「账号或密码不正确」，不区分「账号不存在 / 密码错」；发送验证码的提示不暴露该账号是否已注册。
6. **验证码防刷**：前端 60 秒倒计时 + 服务端频控；验证码一次性、有有效期，校验失败不消耗会话。
7. **数据最小化**：只存学习进度；不采集设备通讯录、位置、剪贴板等。导出/导入仍保留，用户可自行备份。
8. **退出即清内存态**：退出登录后内存中的会话与 rev 归零，界面回到未登录态；本机进度保留（用户主动选择）。
9. **本地数据未加密**：`localStorage` 明文保存进度（不含密码/邮箱以外无敏感字段）；共用设备建议退出登录并清站点数据。
10. **备份**：云端单行快照，若误覆盖可用「导出进度」的历史备份恢复；建议定期导出一次 JSON。

## 四、验收清单

- [ ] 线上域名打开 → 数据页「账号与云同步」显示未登录态
- [ ] 邮箱验证码登录：收码 → 验证 → 面板显示账号与「上次同步」
- [ ] 学几张卡 → 切到另一台设备登录同一账号 → 进度出现（含今日目标与错题）
- [ ] 两端同时修改 → 刷新后两端数据一致（字段取大合并）
- [ ] 退出登录 → 界面回到未登录，本机进度仍在
- [ ] 小红书小工具包：数据页无账号入口、无网络请求
