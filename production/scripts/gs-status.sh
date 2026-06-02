#!/usr/bin/env bash
# General School 서버 상태 대시보드 — 물리 콘솔(tty1)에 자동 표시.
#
# 깜빡임 없이 갱신: 매 루프 화면을 clear 하지 않고, ANSI 커서를 좌상단(\033[H)으로
# 옮긴 뒤 프레임을 덮어쓴다(\033[J로 아래 잔여만 지움). 숫자만 스르륵 바뀐다.
#
# setup-production.sh가 /usr/local/bin/gs-status로 설치하고
# tty1 자동로그인 + ~/.profile hook으로 연결한다.
# 수동 실행: gs-status   (SSH에서도 동작)
# 종료: Ctrl+C

printf '\033[2J'        # 첫 진입 1회만 전체 클리어
printf '\033[?25l'      # 커서 숨김 (깜빡이는 커서도 제거)
trap 'printf "\033[?25h\n"; exit 0' INT TERM   # 종료 시 커서 복원

while true; do
  frame=$(
    LOCAL_IP=$(hostname -I | tr ' ' '\n' | grep -E '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))' | head -1)
    TS_IP=$(tailscale ip -4 2>/dev/null | head -1)
    echo "==================================================="
    echo "          General School   Server Status"
    echo "==================================================="
    echo " Time: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    echo " [ ACCESS URL ]"
    [ -n "$LOCAL_IP" ] && echo "   Local     : http://$LOCAL_IP"
    [ -n "$TS_IP" ]    && echo "   Tailscale : http://$TS_IP"
    [ -z "$LOCAL_IP$TS_IP" ] && echo "   (no network IP yet)"
    echo ""
    echo " [ SERVICES ]"
    for s in gs-backend gs-frontend gs-hocuspocus nginx; do
      st=$(systemctl is-active "$s" 2>/dev/null)
      mark=" OK "; [ "$st" != "active" ] && mark="DOWN"
      printf "   [%s] %-16s %s\n" "$mark" "$s" "$st"
    done
    echo ""
    echo " [ RECENT LOG : gs-backend ]"
    journalctl -u gs-backend -n 6 --no-pager -o cat 2>/dev/null | sed 's/^/   /'
    echo ""
    echo "---------------------------------------------------"
    echo " 5초 자동 갱신 (깜빡임 없음) | 종료: Ctrl+C | 전체로그: journalctl -u gs-backend -f"
  )
  # 커서를 좌상단으로 → 프레임 덮어쓰기 → 아래 잔여 줄만 지움 (전체 clear 안 함 = 깜빡임 없음)
  printf '\033[H%s\033[J' "$frame"
  sleep 5
done
