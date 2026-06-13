#!/bin/bash
cd /home/sinbc/general_school/backend
source venv/bin/activate
python -m pytest tests/test_edutools.py -q -k poll 2>&1 | tail -25
