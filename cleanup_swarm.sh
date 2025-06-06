#!/bin/bash

# Docker Swarm 叢集清理腳本
# 用法: ./cleanup_swarm.sh -h host1,host2,host3 [-u username] [-p port] [--dry-run]

set -e

# 預設值
SSH_USER=""
SSH_PORT=22
DRY_RUN=false
HOSTS=""

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 使用說明
usage() {
    echo "用法: $0 -h <hosts> [-u username] [-p port] [--dry-run] [--help]"
    echo ""
    echo "參數說明:"
    echo "  -h, --hosts     必需：Docker 節點的 IP 或域名，用逗號分隔"
    echo "                  例如: 192.168.1.10,192.168.1.11,192.168.1.12"
    echo "  -u, --user      SSH 使用者名稱 (預設使用當前使用者)"
    echo "  -p, --port      SSH 連接埠 (預設: 22)"
    echo "  --dry-run       只顯示會執行的命令，不實際執行"
    echo "  --help          顯示此說明"
    echo ""
    echo "範例:"
    echo "  $0 -h 192.168.1.10,192.168.1.11,192.168.1.12"
    echo "  $0 -h node1.example.com,node2.example.com,node3.example.com -u ubuntu -p 2222"
    echo "  $0 -h 192.168.1.10,192.168.1.11,192.168.1.12 --dry-run"
    exit 1
}

# 解析命令列參數
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--hosts)
            HOSTS="$2"
            shift 2
            ;;
        -u|--user)
            SSH_USER="$2"
            shift 2
            ;;
        -p|--port)
            SSH_PORT="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help)
            usage
            ;;
        *)
            echo -e "${RED}錯誤：未知參數 $1${NC}"
            usage
            ;;
    esac
done

# 檢查必需參數
if [[ -z "$HOSTS" ]]; then
    echo -e "${RED}錯誤：必須指定主機列表${NC}"
    usage
fi

# 準備 SSH 使用者參數
SSH_USER_PARAM=""
if [[ -n "$SSH_USER" ]]; then
    SSH_USER_PARAM="$SSH_USER@"
fi

# 將主機字串轉換為陣列
IFS=',' read -ra HOST_ARRAY <<< "$HOSTS"

echo -e "${BLUE}=== Docker Swarm 叢集清理腳本 ===${NC}"
echo -e "${BLUE}目標主機: ${HOST_ARRAY[*]}${NC}"
echo -e "${BLUE}SSH 埠號: $SSH_PORT${NC}"
if [[ -n "$SSH_USER" ]]; then
    echo -e "${BLUE}SSH 使用者: $SSH_USER${NC}"
fi
if [[ "$DRY_RUN" == true ]]; then
    echo -e "${YELLOW}注意：這是預演模式，不會實際執行清理命令${NC}"
fi
echo ""

# 清理函數
cleanup_node() {
    local host=$1
    local ssh_target="${SSH_USER_PARAM}${host}"
    
    echo -e "${GREEN}正在清理節點: $host${NC}"
    echo "----------------------------------------"
    
    # 檢查連線
    if ! ssh -p "$SSH_PORT" -o ConnectTimeout=10 -o BatchMode=yes "$ssh_target" "echo 'Connection test'" >/dev/null 2>&1; then
        echo -e "${RED}錯誤：無法連接到 $host${NC}"
        return 1
    fi
    
    # 清理命令列表
    local commands=(
        "echo '1. 清理未使用的容器...'"
        "docker container prune -f"
        "echo '2. 清理未使用的映像檔...'"
        "docker image prune -a -f"
        "echo '3. 清理未使用的網路...'"
        "docker network prune -f"
        "echo '4. 清理未使用的卷...'"
        "docker volume prune -f"
        "echo '5. 清理建置快取...'"
        "docker builder prune -a -f"
        "echo '6. 顯示清理後的磁碟使用情況...'"
        "docker system df"
    )
    
    if [[ "$DRY_RUN" == true ]]; then
        echo -e "${YELLOW}[預演模式] 會在 $host 執行以下命令:${NC}"
        for cmd in "${commands[@]}"; do
            echo "  $cmd"
        done
    else
        # 實際執行清理
        for cmd in "${commands[@]}"; do
            echo -e "${BLUE}執行: $cmd${NC}"
            if ! ssh -p "$SSH_PORT" "$ssh_target" "$cmd"; then
                echo -e "${RED}警告：命令執行失敗: $cmd${NC}"
            fi
        done
    fi
    
    echo ""
}

# 主要執行流程
main() {
    local failed_hosts=()
    
    for host in "${HOST_ARRAY[@]}"; do
        if ! cleanup_node "$host"; then
            failed_hosts+=("$host")
        fi
    done
    
    # 顯示總結
    echo -e "${BLUE}=== 清理完成總結 ===${NC}"
    echo "總共處理 ${#HOST_ARRAY[@]} 個節點"
    
    if [[ ${#failed_hosts[@]} -eq 0 ]]; then
        echo -e "${GREEN}所有節點清理成功！${NC}"
    else
        echo -e "${RED}以下節點清理失敗: ${failed_hosts[*]}${NC}"
        exit 1
    fi
    
    if [[ "$DRY_RUN" == false ]]; then
        echo ""
        echo -e "${YELLOW}建議：清理完成後可以檢查各節點的磁碟空間使用情況${NC}"
        echo "可以使用以下命令檢查："
        for host in "${HOST_ARRAY[@]}"; do
            echo "  ssh ${SSH_USER_PARAM}${host} 'df -h'"
        done
    fi
}

# 執行主程式
main