# 知乎黑客松知识助手：API 接入评估

> 评估日期：2026-09-09
>
> 文档评估证据范围：仅仓库内 `vendor/zhihu-skill-0.5.3/zhihu` 的 Skill 与 Reference 文档；本评估本身未安装 CLI、未请求任何业务 API、未假定已有任何凭证。
>
> 赛道名称：主代理已根据当前赛事手册核实为“知识炼金场：学习工具与知识生产”；本文件不把该手册以外的本地 Skill 适配建议当作评分规则。
> 结论适用范围：知乎黑客松 2026 校园新锐季的最小可行、来源可追溯知识助手。比赛接口与赛事要求可能调整，提交前仍须以活动页面为准。

## 结论

**建议第一版只接入黑客松“知乎知识”列表与详情接口，不接 OAuth、不接个人知识库、不依赖知乎 CLI，也不把知乎直答作为核心回答引擎。**

这样可以在没有任何凭证的前提下完成一个可公开部署的核心体验：用户在知识作品的标题、摘要与标签中筛选；选择作品后读取其详情内容；页面同时展示作者、标题、标签、作品 `work_id` 与详情接口链接，令每段展示内容可以回到具体的知乎赛事内容来源。它可为“知行小课”中的概念解释、复述反馈与小测提供可核查的材料层；其教学逻辑、题目质量与任何评分结论需由产品设计和当前赛事规则另行验证。

黑客松知识 API 的列表和详情均为无鉴权 GET；文档把详情 `content` 标为“正文”，但这**不能推导为完整全文保证**。主代理 2026-09-09 的独立实测样本中，`1523701957479239680`（刀熊说说，《实现大目标：依靠「小胜」和「闭合任务回路》）的 `content` 恰为 3,000 字符，末尾停在“懒”，存在明显截断信号；完整性须显示为“未知”。本评估未自行发起该网络请求，实测样本保存于 `sources/knowledge-list-2026-09-09.json` 与 `sources/knowledge-detail-1523701957479239680.json`。文档没有提供按关键词搜索、按标签筛选或分页参数，因此“搜索”必须限于应用对列表元数据做本地筛选，不能宣传为“搜索全量知乎”或“官方语义检索”。参见 [hackathon-content-api.md:8-28](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon-content-api.md#L8-L28)、[hackathon-content-api.md:54-80](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon-content-api.md#L54-L80)。

## 先分清三类“知识”

| 名称 | 归属与用途 | 能否指定检索范围 | 是否有完整正文保证 | 第一版是否使用 |
|---|---|---|---|---|
| 黑客松“知乎知识”内容 | 本次比赛配套、由列表和 `work_id` 详情访问的作品内容 | **不能**：文档只列出全量列表与按 `work_id` 详情；只能在客户端基于标题、摘要、标签筛选 | **无完整性保证**：虽有 `content` 字段，9 月 9 日样本恰为 3,000 字符且疑似截断 | **使用，显示完整性未知** |
| 开放平台知乎站内搜索 | 公共知乎问题、回答、文章的关键词搜索 | 只能传 `Query` 与最多 10 条 `Count`；没有指定某篇/某个集合的检索参数 | **没有**：`ContentText` 被定义为“内容摘要”；应跳转其 `Url` 阅读原文 | 暂不使用；可作后续“扩展资料”功能 |
| 个人知识库（RAG） | Access Secret 所属账号可访问的知识库及其上传内容 | 可用 `KnowledgeBaseIDs` 和/或 `RecallScopes` 指定范围；`personal`、`subscription`、`public` 可选 | **没有文档保证**：检索结果只描述为有序 `Content: array[string]`，未给出每段与 `RecallContentID`/`OriginUrl` 的对应关系 | **不使用**；不能把它等同于黑客松“知乎知识” |

黑客松接口明确仅面向本次比赛，活动结束后路径、响应和可用状态可能变化；不要把它包装成长期平台承诺。[hackathon-content-api.md:1-6](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon-content-api.md#L1-L6)、[hackathon-content-api.md:120-130](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon-content-api.md#L120-L130)。

开放平台站内搜索的端点、参数和 10 条上限见 [http-api.md:300-329](../vendor/zhihu-skill-0.5.3/zhihu/references/http-api.md#L300-L329)，其返回字段将 `ContentText` 定义为摘要并返回带溯源 UTM 的 `Url`，[http-api.md:331-360](../vendor/zhihu-skill-0.5.3/zhihu/references/http-api.md#L331-L360)。个人知识库的范围、分页与 RAG 返回形态见 [http-api.md:705-757](../vendor/zhihu-skill-0.5.3/zhihu/references/http-api.md#L705-L757)。

## 最小接入设计

### 仅需两个比赛专用 HTTP GET

1. `GET https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/list`
   - 用途：获取可展示的 `work_id`、`title`、`description`、`labels` 和图片；用户输入只在这些已取得的字段中本地匹配。
2. `GET https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/{work_id}`
   - 用途：用户打开某项时获取 `chapter_name`、`author_name`、`introduction`、`labels` 和 `content`；它是接口提供的内容片段，不能在 UI 中承诺为完整全文。

这两个 URL、列表字段和详情字段均来自比赛专用文档。[hackathon-content-api.md:19-28](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon-content-api.md#L19-L28)、[hackathon-content-api.md:30-80](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon-content-api.md#L30-L80)。

建议将调用放在自己的后端路由或 serverless 函数内，以缓存列表/详情、统一校验与错误呈现；文档未说明浏览器跨域（CORS）行为，不能假定前端可以直连。实现上只接受本次列表返回的、非空且不含 `/`、`?`、`#` 或换行的 `work_id`，使用 URL path 编码；失败时显示真实 HTTP 状态和安全收敛后的错误，不循环重试。[hackathon-content-api.md:116-118](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon-content-api.md#L116-L118)。

页面每次呈现内容时至少保留：`author_name`、`chapter_name`、`work_id`，以及详情端点链接（可作为“查看来源”）；显示“接口内容完整性未知”。原文较长时先显示与问题相关的节选，再由用户展开；不得将原文伪称为应用或用户创作，且要控制单次输出长度。[hackathon-content-api.md:120-128](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon-content-api.md#L120-L128)。

列表的 `labels` 只能作为原始展示字段，不能作可信的学科/主题分类：上述实测列表里“职场”标题的条目出现“悬疑 / 警察 / 犯罪 / 现代”标签。骨架应保留未识别字段和原始标签，产品层不可据此自动生成学习分类或结论。

### “助手”回答的边界

- 第一版可做“检索—阅读—带出处摘要/问答”体验，但每个结论必须链接到已选 `work_id` 和正文片段；不要给出没有可回溯作品的断言。
- 若后续加入生成模型，应把取到的接口内容作为受限、完整性未知的上下文，并让输出按 `work_id` 标注引用。知乎直答 API 的协议仅保证 `model`、`messages`、`stream` 三个请求字段，没有承诺返回来源引用；因此它不适合单独承担“可追溯”的证据层。[http-api.md:518-559](../vendor/zhihu-skill-0.5.3/zhihu/references/http-api.md#L518-L559)、[http-api.md:629-636](../vendor/zhihu-skill-0.5.3/zhihu/references/http-api.md#L629-L636)。
- 黑客松开发指南要求对有额度能力做缓存和请求去重，也禁止批量、高频和无意义调用；此处采用缓存是工程建议，文档没有给出可宣称的缓存时长或具体频率阈值。[hackathon.md:47-55](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon.md#L47-L55)。

## 鉴权与凭证决策

| 能力 | 是否需要凭证 | 最小版本的决定 | 原因 |
|---|---|---|---|
| 黑客松知识列表/详情 | 否；不带 `Authorization`、Access Secret 或 OAuth Header | 接入 | 赛事内容接口与 OAuth 独立，可在未取得凭证时实现 |
| 知乎站内搜索、全网搜索、热榜、直答、个人知识库 | 是：`Authorization: Bearer <Access Secret>` 与秒级 `X-Request-Timestamp` | 暂不接入 | 用户尚未提供 Access Secret；其中搜索/知识库也不保证完整正文或逐段来源映射 |
| 黑客松 OAuth / 授权用户的创作关注收藏 | App ID、App Key、用户 OAuth Token，且调用用户数据还要 Access Secret | 不接入 | 只在要“知乎登录”或代用户读数据时才需要；与比赛内容接口无关 |

比赛接口的无鉴权范围在 [hackathon-content-api.md:8-17](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon-content-api.md#L8-L17)。普通开放能力的 Bearer 请求头与时间戳要求见 [http-api.md:21-45](../vendor/zhihu-skill-0.5.3/zhihu/references/http-api.md#L21-L45)。Access Secret 的申请入口、当前文档记录的邀测额度及“同账号共享额度池”见 [open-platform.md:9-52](../vendor/zhihu-skill-0.5.3/zhihu/references/open-platform.md#L9-L52)；额度规则可能变化，不能当作比赛固定配额。

OAuth 只在应用需让其他知乎用户登录、或代表已授权用户读创作/关注/收藏时才有用；项目创建后才会由赛事页面分配 `app_id`/`app_key`，且它们不能替代 Access Secret。[hackathon.md:75-103](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon.md#L75-L103)。如未来确有该需求，授权用户数据调用必须同时发送 Access Secret、`X-OAuth-Token` 和时间戳，所有密钥只能在后端保存。[hackathon-oauth.md:67-85](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon-oauth.md#L67-L85)。

## CLI 是否必要

**不必要，也不应成为线上作品的运行依赖。**

CLI 是日常使用开放能力的封装；Skill 明确要求“开发接入场景”阅读原始 HTTP API，而比赛专用故事/知识接口“当前不属于 CLI，直接按文档调用 HTTP API”。[SKILL.md:11-13](../vendor/zhihu-skill-0.5.3/zhihu/SKILL.md#L11-L13)、[SKILL.md:175-183](../vendor/zhihu-skill-0.5.3/zhihu/SKILL.md#L175-L183)。

如果将来添加需要 Access Secret 的能力，CLI 可帮助开发者本地检查凭证和额度，但不是 Web 应用的 SDK：它需要先经用户授权安装，且凭证验证、读取本人内容都会触发业务请求并可能消耗额度。[SKILL.md:29-55](../vendor/zhihu-skill-0.5.3/zhihu/SKILL.md#L29-L55)。线上服务应直接实现所需 HTTP 请求，并将 Access Secret 留在部署平台 Secret 中；第一版根本不应索取该凭证。

## 单人可实施范围与验收清单

最小范围：一个公网可访问页面；“知乎知识”列表的本地关键词/标签筛选；单项详情阅读；带作者和 `work_id` 的来源卡；接口空数据、网络失败、字段缺失时的真实提示。这个范围没有 OAuth、用户资料、上传、个人知识库、完整知乎站内检索或 CLI 安装依赖。

上线前应实际检查：

- 知识列表能加载，详情只使用其返回的 `work_id`；
- 每个展示内容都能看到作者、作品名、来源链接与“完整性未知”；
- 失败、空数据与字段缺失不生成虚构内容；
- 缓存和请求去重在实际部署环境生效；
- 公网 Demo 能打开并完成核心流程。

后两项属于上线验证，不可由本次文档阅读替代。黑客松指南将“可公开访问、能操作的线上 Demo”和产品说明列为必交材料，并要求对页面、接口和登录做实际运行验证；这记录的是本地赛事指南，不是本评估对当前活动页面或评分标准的独立核实。[hackathon.md:105-136](../vendor/zhihu-skill-0.5.3/zhihu/references/hackathon.md#L105-L136)。

## 目前需要补齐的外部事实

1. 活动页面中正式的赛道名称、当前提交字段和规则（本地指南自身说明这些可能变化）。
2. 比赛接口在目标部署地区的可用性、实际响应、CORS 策略和内容规模；本评估未请求接口。主代理已保存一次 10 条列表和一条详情的实测样本，但这不能替代目标部署时的运行验证。
3. 若要引入站内搜索/直答/个人知识库：先由账户持有人自行申请 Access Secret，再确认当日额度；不能把 OAuth `app_key` 当作 Access Secret。
