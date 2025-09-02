# 环境变量配置指南

## 📋 文件说明

| 文件名 | 用途 | Git状态 | 包含内容 |
|--------|------|----------|----------|
| `.env.example` | 配置模板 | ✅ 提交 | 示例值和说明 |
| `.env` | 实际配置 | ❌ 忽略 | 真实的密钥和密码 |
| `.env.local` | 本地开发 | ❌ 忽略 | 本地环境配置 |
| `.env.production` | 生产环境 | ❌ 忽略 | 生产环境密钥 |

## 🔑 为什么这样设计？

### `.env.example` 应该被提交的原因：

1. **📚 它是文档**
   - 告诉其他开发者需要哪些配置
   - 说明每个变量的格式和用途
   - 提供配置示例

2. **🔒 它是安全的**
   - 只包含假的/示例值
   - 不包含任何真实密钥
   - 帮助避免配置错误

3. **🤝 它促进协作**
   - 新成员可以快速了解项目配置
   - 减少配置相关的问题
   - 标准化团队的配置方式

### `.env` 必须被忽略的原因：

1. **🚨 包含敏感信息**
   - 真实的API密钥
   - 数据库密码
   - 私钥和密钥

2. **💰 安全风险**
   - 泄露可能导致财务损失
   - 暴露用户数据
   - 被恶意利用

## 📝 正确的使用流程

```bash
# 1. 克隆项目后
git clone <repository>
cd <project>

# 2. 创建你的 .env 文件
cp .env.example .env

# 3. 编辑 .env，填入你的真实配置
vim .env
# 或
code .env

# 4. 确认 .env 被忽略
git status
# 不应该看到 .env 文件

# 5. 如果不小心添加了 .env
git rm --cached .env  # 从Git中移除但保留本地文件
```

## 🎯 最佳实践

### ✅ 应该做的：

```bash
# 提交模板文件
git add .env.example

# 在 README 中说明如何配置
echo "Copy .env.example to .env and configure" >> README.md

# 为不同环境创建不同的模板
.env.example          # 通用模板
.env.development.example  # 开发环境模板
.env.production.example   # 生产环境模板
```

### ❌ 不应该做的：

```bash
# 永远不要提交真实的 .env
git add .env  # ❌ 错误！

# 不要在代码中硬编码密钥
const API_KEY = "sk-real-key-123"  # ❌ 错误！

# 不要在 .env.example 中放真实密钥
REAL_API_KEY=sk-actual-key-456  # ❌ 错误！
```

## 🔍 检查命令

```bash
# 确认 .env 被忽略
git check-ignore .env
# 输出: .env (表示被忽略)

# 确认 .env.example 没有被忽略
git check-ignore .env.example
# 无输出 (表示没有被忽略)

# 查看所有被追踪的文件
git ls-files | grep env
# 应该只看到 .env.example，不应该看到 .env
```

## 🛡️ 安全提醒

1. **定期轮换密钥** - 即使没有泄露，也要定期更新
2. **使用密钥管理服务** - 生产环境考虑使用 AWS Secrets Manager、HashiCorp Vault 等
3. **最小权限原则** - API密钥只授予必要的权限
4. **监控异常** - 监控API使用情况，发现异常立即处理

## 📚 相关文件

- `.gitignore` - 定义忽略规则
- `SECURITY.md` - 安全最佳实践
- `README.md` - 项目说明文档

---

记住：**`.env.example` 是你的朋友，`.env` 是你的秘密！**