# OMate Cloud

OMate LivePage cloud backend: memory, prompts, long-term memory, worldbook, knowledge base and main-chat context.

## 手机端部署

1. 在 Supabase 新建自己的项目，保存 Project ID 和数据库密码。
2. 在 Supabase 账户设置生成 Personal Access Token。
3. 在自己的 GitHub 仓库 Settings → Secrets and variables → Actions 中添加三个 **Repository secrets**：
   - `SUPABASE_ACCESS_TOKEN`：Supabase Personal Access Token
   - `SUPABASE_DB_PASSWORD`：新项目数据库密码
   - `SUPABASE_PROJECT_ID`：新项目的 Project ID
4. 打开 [一键部署工作流](../../actions/workflows/deploy-omate-cloud.yml)，选择 main 分支，点击 **Run workflow**。
5. 等待所有步骤通过，在 Supabase 核对五张表和四个 Edge Functions。
6. 在 LivePage 填写自己项目的 URL 和 Publishable Key，并完成账号授权。

**请注意：** 目前数据库迁移和四个云端函数已在独立免费测试项目中分别部署成功，但 GitHub Actions 全流程尚未实测。自动化不会替用户创建 Supabase 项目或配置 LivePage。知识库向量化可能需要另外配置嵌入模型接口。

**安全：** 不要公开 Token、数据库密码或 service_role 密钥；不要对原有正式云端执行测试部署。
