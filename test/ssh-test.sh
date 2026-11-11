#!/usr/bin/env bash
# Dung mot sshd nho trong docker de test duong ham SSH.
#
# Container nam cung mang voi MySQL nen tu trong do thay duoc `daily-mysql:3306`
# — dung kieu tinh huong that: MySQL khong mo ra ngoai, chi vao duoc qua SSH.
#
#   bash test/ssh-test.sh up     # dung server + sinh khoa
#   bash test/ssh-test.sh down   # don sach
set -euo pipefail

TEN=tableu-sshd-test
MANG=${TABLEU_SSH_NETWORK:-daily_default}
THU_MUC="${TMPDIR:-/tmp}/tableu-ssh-test"
KHOA="$THU_MUC/test_key"

up() {
  mkdir -p "$THU_MUC"
  [ -f "$KHOA" ] || ssh-keygen -t ed25519 -N '' -f "$KHOA" -C 'tableu-test' >/dev/null

  cat > "$THU_MUC/Dockerfile" <<'EOF'
FROM nginx:alpine
RUN apk add --no-cache openssh-server \
 && ssh-keygen -A \
 && adduser -D -s /bin/sh tunnel \
 && echo 'tunnel:matkhauthu' | chpasswd \
 && mkdir -p /home/tunnel/.ssh
COPY test_key.pub /home/tunnel/.ssh/authorized_keys
RUN chown -R tunnel:tunnel /home/tunnel/.ssh && chmod 700 /home/tunnel/.ssh \
 && chmod 600 /home/tunnel/.ssh/authorized_keys \
 && sed -i 's/^#*AllowTcpForwarding.*/AllowTcpForwarding yes/' /etc/ssh/sshd_config \
 && sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
EOF

  docker build -q -t "$TEN" "$THU_MUC" >/dev/null
  docker rm -f "$TEN" >/dev/null 2>&1 || true
  docker run -d --name "$TEN" --network "$MANG" -p 127.0.0.1:2222:22 "$TEN" >/dev/null
  sleep 2
  echo "sshd test dang chay o 127.0.0.1:2222"
  echo "  tài khoản : tunnel"
  echo "  mật khẩu  : matkhauthu"
  echo "  khóa riêng: $KHOA"
  echo
  echo "Chạy test:  TABLEU_SSH_KEY=$KHOA npm test 12"
}

down() {
  docker rm -f "$TEN" >/dev/null 2>&1 || true
  docker rmi -f "$TEN" >/dev/null 2>&1 || true
  rm -rf "$THU_MUC"
  echo "da don sach sshd test"
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  *) echo "Dùng: bash test/ssh-test.sh [up|down]"; exit 2 ;;
esac
