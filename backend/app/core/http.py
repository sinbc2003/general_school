"""HTTP 응답 헬퍼."""

from urllib.parse import quote


def content_disposition(filename: str, inline: bool = False) -> str:
    """RFC 5987 안전한 Content-Disposition 헤더 값을 만든다.

    한글 등 비-ASCII 파일명을 그대로 헤더에 넣으면 Starlette가 헤더를
    latin-1로 인코딩하다 UnicodeEncodeError → 500이 난다. 이를 막기 위해
    ASCII fallback(`filename=`)과 UTF-8 인코딩(`filename*=`)을 함께 제공한다.
    반환 문자열은 항상 순수 ASCII(latin-1 안전)이다.

    예: content_disposition("이학생_portfolio.pdf", inline=True)
        -> inline; filename="_______portfolio.pdf"; filename*=UTF-8''%EC...
    """
    disposition = "inline" if inline else "attachment"
    # ASCII fallback — 비-ASCII는 '_'로 치환 (latin-1 안전 보장)
    ascii_name = filename.encode("ascii", "replace").decode("ascii").replace("?", "_")
    # 따옴표/역슬래시는 헤더 토큰을 깨므로 제거
    ascii_name = ascii_name.replace('"', "_").replace("\\", "_")
    quoted = quote(filename, safe="")
    return f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quoted}"
