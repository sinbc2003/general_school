#!/bin/bash
# frontend tsc 검증
cd /home/sinbc/general_school/frontend
npx tsc --noEmit > /tmp/tsc.log 2>&1
code=$?
echo "tsc exit code: $code"
if [ $code -ne 0 ]; then
  head -40 /tmp/tsc.log
fi
exit $code
