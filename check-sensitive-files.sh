#!/bin/bash

# 检查敏感文件脚本
echo "🔍 检查项目中的敏感文件..."
echo "================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查函数
check_files() {
    local pattern=$1
    local description=$2
    
    echo -e "\n${YELLOW}检查 ${description}:${NC}"
    
    # 查找文件（排除node_modules和.git）
    files=$(find . -path ./node_modules -prune -o -path ./.git -prune -o -name "$pattern" -type f -print 2>/dev/null)
    
    if [ -z "$files" ]; then
        echo -e "${GREEN}✓ 没有找到 ${description}${NC}"
    else
        echo -e "${RED}✗ 发现以下 ${description}:${NC}"
        echo "$files"
        
        # 检查是否被.gitignore忽略
        for file in $files; do
            if git check-ignore "$file" 2>/dev/null; then
                echo -e "  ${GREEN}✓ $file (已忽略)${NC}"
            else
                echo -e "  ${RED}✗ $file (未忽略！)${NC}"
            fi
        done
    fi
}

# 检查各种敏感文件
check_files "*.env" "环境变量文件"
check_files "*.key" "私钥文件"
check_files "*.pem" "证书文件"
check_files "*.p12" "证书文件"
check_files "*.pfx" "证书文件"
check_files "mnemonic.txt" "助记词文件"
check_files "seed.txt" "种子文件"
check_files "private-key*" "私钥文件"
check_files "secret*" "密钥文件"
check_files "config.yaml" "配置文件"
check_files "config.json" "配置文件"
check_files "*.db" "数据库文件"
check_files "*.sqlite" "SQLite文件"

echo -e "\n================================"
echo "🔍 检查完成！"

# 检查.gitignore文件是否存在
if [ -f .gitignore ]; then
    echo -e "${GREEN}✓ .gitignore 文件存在${NC}"
else
    echo -e "${RED}✗ .gitignore 文件不存在！${NC}"
fi

# 显示当前被Git忽略的文件数量
ignored_count=$(git status --ignored --untracked-files=all 2>/dev/null | grep -c "ignored:" || echo "0")
echo -e "\n📊 当前被忽略的文件/目录数: ${ignored_count}"