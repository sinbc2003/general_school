#!/usr/bin/env bash
# General School 서버 상태 대시보드 — 물리 콘솔(tty1)에 자동 표시.
#
# setup-production.sh가 이 파일을 /usr/local/bin/gs-status로 설치하고
# tty1 자동로그인 + ~/.profile hook으로 연결한다.
# 노트북을 서버로 쓸 때 화면에 "접속 주소 + 서비스 상태 + 최근 로그"가 보이게 함.
#
# 수동 실행: gs-status   (SSH에서도 동작)
# 종료: Ctrl+C

while true; do
  clear
  LOCAL_IP=$(hostname -I | tr ' ' '\n' | grep -E '^(192\.168|10\.|172\.)' | head -1)
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
  echo " refresh 5s | exit: Ctrl+C | full log: journalctl -u gs-backend -f"
  sleep 5
done
