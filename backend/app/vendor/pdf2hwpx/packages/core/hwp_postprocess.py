"""
HWPX 후처리 — 한글 COM으로 수식 크기 재계산

한/글 매크로 API 사용: 첫 수식 선택 → 개체속성 → 적용범위=문서전체 → 설정.
pyautogui 좌표 기반 대신 한/글 API의 ModifyShapeObject + EquationObjOption 사용.

Usage:
    python hwp_postprocess.py input.hwpx [output.hwpx]

파이프라인 연동:
    from hwp_postprocess import postprocess_hwpx
    postprocess_hwpx("input.hwpx", "output.hwpx")  # output 생략 시 덮어쓰기
"""

import sys
import os
import time
import logging

logger = logging.getLogger(__name__)


def _is_available() -> bool:
    """HWP COM 사용 가능 여부 확인"""
    try:
        import win32com.client
        return True
    except ImportError:
        return False


def postprocess_hwpx(input_path: str, output_path: str = None) -> str:
    """HWPX 파일의 수식 크기를 재계산하여 저장

    방법: 한/글 COM으로 문서 열기 → 첫 수식 찾기 → 개체속성(수식) →
    적용범위=문서전체 → 설정 → 저장.

    Args:
        input_path: 입력 HWPX 경로
        output_path: 출력 경로 (None이면 input_path 덮어쓰기)

    Returns:
        저장된 파일 경로. 실패 시 원본 경로 반환.
    """
    import win32com.client

    input_path = os.path.abspath(input_path)
    if output_path is None:
        output_path = input_path
    else:
        output_path = os.path.abspath(output_path)

    logger.info(f"HWP 후처리 시작: {input_path}")

    hwp = None
    try:
        hwp = win32com.client.gencache.EnsureDispatch("HWPFrame.HwpObject")
        hwp.XHwpWindows.Item(0).Visible = False
        try:
            hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        except Exception:
            pass

        hwp.Open(input_path)
        time.sleep(0.5)

        # 문서 시작으로 이동
        hwp.HAction.Run("MoveDocBegin")
        time.sleep(0.3)

        # 첫 수식 컨트롤 찾기
        ctrl = hwp.HeadCtrl
        eq_found = False
        while ctrl is not None:
            try:
                if ctrl.UserDesc == "수식":
                    pos = ctrl.GetAnchorPos(0)
                    hwp.SetPosBySet(pos)
                    hwp.HAction.Run("SelectCtrlFront")
                    time.sleep(0.3)
                    eq_found = True
                    break
            except Exception:
                pass
            try:
                ctrl = ctrl.Next
            except Exception:
                break

        if not eq_found:
            logger.info("수식 없음 — 후처리 건너뜀")
        else:
            # 한/글 매크로 API로 수식 속성 변경
            # EquationObjOption: 적용범위를 "문서 전체"로 설정
            act = hwp.CreateAction("EquationPropertyChange")
            pset = act.CreateSet()
            act.GetDefault(pset)

            # ApplyTo: 0=현재수식, 1=문서전체
            try:
                pset.SetItem("ApplyScope", 1)  # 문서 전체
            except Exception:
                pass

            act.Execute(pset)
            time.sleep(1)
            logger.info("수식 크기 재계산 완료 (API)")

        # 저장
        hwp.SaveAs(output_path, "HWPX")
        logger.info(f"저장 완료: {output_path}")
        time.sleep(0.5)

    except Exception as e:
        logger.error(f"후처리 실패: {e}")
        # API 방식 실패 시 pyautogui 폴백 시도
        try:
            output_path = _fallback_pyautogui(hwp, input_path, output_path)
        except Exception as e2:
            logger.error(f"pyautogui 폴백도 실패: {e2}")
            output_path = input_path
    finally:
        if hwp:
            try:
                hwp.Clear(1)
            except Exception:
                pass
            try:
                hwp.Quit()
            except Exception:
                pass

    return output_path


def _fallback_pyautogui(hwp, input_path: str, output_path: str) -> str:
    """API 방식 실패 시 pyautogui로 대화상자 조작"""
    import pyautogui
    import pygetwindow as gw
    import threading

    logger.info("pyautogui 폴백 시도...")

    if hwp is None:
        import win32com.client
        hwp = win32com.client.gencache.EnsureDispatch("HWPFrame.HwpObject")
        hwp.XHwpWindows.Item(0).Visible = True
        try:
            hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        except Exception:
            pass
        hwp.Open(input_path)
        time.sleep(1)

    hwp.XHwpWindows.Item(0).Visible = True
    time.sleep(0.5)

    # 첫 수식 찾기
    hwp.HAction.Run("MoveDocBegin")
    time.sleep(0.3)
    ctrl = hwp.HeadCtrl
    eq_found = False
    while ctrl is not None:
        try:
            if ctrl.UserDesc == "수식":
                pos = ctrl.GetAnchorPos(0)
                hwp.SetPosBySet(pos)
                hwp.HAction.Run("SelectCtrlFront")
                time.sleep(0.3)
                eq_found = True
                break
        except Exception:
            pass
        try:
            ctrl = ctrl.Next
        except Exception:
            break

    if not eq_found:
        return input_path

    def _handle_dialog():
        time.sleep(2)
        dlg = None
        for _ in range(10):
            wins = [w for w in gw.getAllWindows()
                    if '속성' in w.title or 'Property' in w.title]
            if wins:
                dlg = wins[0]
                break
            time.sleep(0.5)
        if not dlg:
            return
        dlg.activate()
        time.sleep(0.3)
        dx, dy = dlg.left, dlg.top
        # 수식 탭
        pyautogui.click(dx + 155, dy + 53)
        time.sleep(0.5)
        # 적용범위 콤보
        pyautogui.click(dx + 175, dy + 248)
        time.sleep(0.3)
        pyautogui.hotkey('alt', 'down')
        time.sleep(0.3)
        pyautogui.press('end')
        time.sleep(0.2)
        pyautogui.press('enter')
        time.sleep(0.3)
        # 설정 버튼
        pyautogui.click(dx + 565, dy + 55)
        time.sleep(0.5)

    t = threading.Thread(target=_handle_dialog, daemon=True)
    t.start()
    hwp.HAction.Run("ModifyShapeObject")
    t.join(timeout=15)
    time.sleep(0.5)

    hwp.SaveAs(output_path, "HWPX")
    time.sleep(0.5)
    return output_path


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("Usage: python hwp_postprocess.py input.hwpx [output.hwpx]")
        sys.exit(1)

    inp = args[0]
    out = args[1] if len(args) > 1 else None
    result = postprocess_hwpx(inp, out)
    print(f"Done: {result}")
