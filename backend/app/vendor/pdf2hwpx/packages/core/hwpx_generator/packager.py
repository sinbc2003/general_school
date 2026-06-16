#!/usr/bin/env python3
"""
HWPX Packager

section0.xml + 템플릿 파일들 → HWPX(ZIP) 파일 생성.

HWPX 파일 구조:
  mimetype                    (비압축, 첫 번째 엔트리)
  version.xml
  settings.xml
  META-INF/container.xml
  META-INF/container.rdf
  META-INF/manifest.xml
  Contents/header.xml         (글자/문단 스타일 정의)
  Contents/section0.xml       (본문 — builder.py에서 생성)
  Contents/content.hpf        (패키지 매니페스트)
  BinData/                    (이미지 등 바이너리)
  Preview/                    (미리보기)
"""

import zipfile
import os
from pathlib import Path

# 기본 템플릿 디렉토리
DEFAULT_TEMPLATE_DIR = Path(__file__).parent / "templates" / "base"


def package_hwpx(
    section_xml,
    output_path: str,
    template_dir: str = None,
    title: str = "문서",
    images: dict = None,
) -> str:
    """HWPX 파일 생성

    Args:
        section_xml: section0.xml 문자열 또는 [section0, section1, ...] 리스트
        output_path: 출력 HWPX 파일 경로
        template_dir: 템플릿 디렉토리 경로 (None이면 기본 템플릿 사용)
        title: 문서 제목 (content.hpf 메타데이터)
        images: {"image1.png": bytes, ...} 형태의 이미지 데이터

    Returns:
        출력 파일의 절대 경로
    """
    # 하위 호환: 단일 문자열이면 리스트로 감싸기
    if isinstance(section_xml, str):
        sections = [section_xml]
    else:
        sections = list(section_xml)

    if template_dir is None:
        template_dir = str(DEFAULT_TEMPLATE_DIR)

    template_path = Path(template_dir)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(str(output), 'w') as zf:
        # 1. mimetype (비압축, 반드시 첫 번째 엔트리)
        mimetype_file = template_path / "mimetype"
        if mimetype_file.exists():
            mimetype_content = mimetype_file.read_bytes()
        else:
            mimetype_content = b"application/hwp+zip"
        zf.writestr(
            zipfile.ZipInfo("mimetype"),
            mimetype_content,
            compress_type=zipfile.ZIP_STORED
        )

        # 2. version.xml
        _write_template_file(zf, template_path, "version.xml")

        # 3. settings.xml
        _write_template_file(zf, template_path, "settings.xml")

        # 4. META-INF 파일들
        _write_template_file(zf, template_path, "META-INF/container.xml")
        _write_template_file(zf, template_path, "META-INF/manifest.xml")

        # container.rdf
        rdf_content = _build_container_rdf(images, len(sections))
        zf.writestr("META-INF/container.rdf", rdf_content,
                     compress_type=zipfile.ZIP_DEFLATED)

        # 5. Contents/header.xml (템플릿에서 그대로 사용)
        _write_template_file(zf, template_path, "Contents/header.xml")

        # 6. Contents/section{i}.xml (다중 섹션)
        for i, sec_xml in enumerate(sections):
            zf.writestr(
                f"Contents/section{i}.xml",
                sec_xml.encode('utf-8'),
                compress_type=zipfile.ZIP_DEFLATED
            )

        # 7. Contents/content.hpf (패키지 매니페스트)
        content_hpf = _build_content_hpf(title, images, len(sections))
        zf.writestr(
            "Contents/content.hpf",
            content_hpf.encode('utf-8'),
            compress_type=zipfile.ZIP_DEFLATED
        )

        # 8. BinData (이미지)
        if images:
            for name, data in images.items():
                zf.writestr(
                    f"BinData/{name}",
                    data,
                    compress_type=zipfile.ZIP_DEFLATED
                )

        # 9. Preview (간단한 텍스트 미리보기)
        zf.writestr(
            "Preview/PrvText.txt",
            title.encode('utf-8'),
            compress_type=zipfile.ZIP_DEFLATED
        )

    return str(output.resolve())


def _inject_bindata_list(header_xml: str, images: dict) -> str:
    """header.xml에 <hh:binDataList> 삽입 — 한/글이 이미지를 인식하기 위해 필수"""
    bindata_items = []
    for idx, name in enumerate(images.keys()):
        item_id = name.rsplit('.', 1)[0]  # image1.png → image1
        ext = name.rsplit('.', 1)[-1].upper() if '.' in name else 'PNG'
        # <hh:binDataEmbedding> — 한/글 HWPX 이미지 등록 형식
        bindata_items.append(
            f'<hh:binDataEmbedding id="{idx + 1}" encoding="UTF-8" '
            f'storageId="{item_id}" extension="{ext}"/>'
        )

    bindata_list = f'<hh:binDataList>{"".join(bindata_items)}</hh:binDataList>'

    # </hh:mappingTable> 뒤에 삽입 (idMappings 섹션 안)
    insert_point = header_xml.find('</hh:mappingTable>')
    if insert_point != -1:
        insert_point += len('</hh:mappingTable>')
        header_xml = header_xml[:insert_point] + bindata_list + header_xml[insert_point:]
    else:
        # fallback: </hh:refList> 앞에 삽입
        insert_point = header_xml.find('</hh:refList>')
        if insert_point != -1:
            header_xml = header_xml[:insert_point] + bindata_list + header_xml[insert_point:]

    return header_xml


def _write_template_file(zf: zipfile.ZipFile, template_path: Path, name: str):
    """템플릿 디렉토리에서 파일을 읽어 ZIP에 추가"""
    file_path = template_path / name
    if file_path.exists():
        zf.writestr(
            name,
            file_path.read_bytes(),
            compress_type=zipfile.ZIP_DEFLATED
        )
    else:
        raise FileNotFoundError(f"Template file not found: {file_path}")


def _build_container_rdf(images: dict = None, section_count: int = 1) -> str:
    """container.rdf 생성"""
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
        '<rdf:Description rdf:about="">',
        '<ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" '
        'rdf:resource="Contents/header.xml"/>',
        '</rdf:Description>',
        '<rdf:Description rdf:about="Contents/header.xml">',
        '<rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#HeaderFile"/>',
        '</rdf:Description>',
    ]
    for i in range(section_count):
        parts.extend([
            '<rdf:Description rdf:about="">',
            '<ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" '
            f'rdf:resource="Contents/section{i}.xml"/>',
            '</rdf:Description>',
            f'<rdf:Description rdf:about="Contents/section{i}.xml">',
            '<rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#SectionFile"/>',
            '</rdf:Description>',
        ])
    parts.extend([
        '<rdf:Description rdf:about="">',
        '<rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/>',
        '</rdf:Description>',
        '</rdf:RDF>',
    ])
    return ''.join(parts)


def _build_content_hpf(title: str = "문서", images: dict = None, section_count: int = 1) -> str:
    """content.hpf (OPF 매니페스트) 생성"""
    ns_attrs = (
        'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" '
        'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" '
        'xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" '
        'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" '
        'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" '
        'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" '
        'xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" '
        'xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" '
        'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:opf="http://www.idpf.org/2007/opf/" '
        'xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" '
        'xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" '
        'xmlns:epub="http://www.idpf.org/2007/ops" '
        'xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"'
    )

    # 이미지 매니페스트 아이템
    image_items = ""
    if images:
        for name in images:
            ext = name.rsplit('.', 1)[-1].lower()
            media_type = {
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'bmp': 'image/bmp',
                'gif': 'image/gif',
            }.get(ext, 'application/octet-stream')
            item_id = name.rsplit('.', 1)[0]
            image_items += (
                f'<opf:item id="{item_id}" href="BinData/{name}" '
                f'media-type="{media_type}" isEmbeded="1"/>'
            )

    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'
        f'<opf:package {ns_attrs} version="" unique-identifier="" id="">'
        f'<opf:metadata>'
        f'<opf:title>{title}</opf:title>'
        f'<opf:language>ko</opf:language>'
        f'<opf:meta name="creator" content="text">pdf2hwpx</opf:meta>'
        f'</opf:metadata>'
        f'<opf:manifest>'
        f'<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>'
        f'{image_items}'
        + ''.join(f'<opf:item id="section{i}" href="Contents/section{i}.xml" media-type="application/xml"/>'
                  for i in range(section_count)) +
        f'<opf:item id="settings" href="settings.xml" media-type="application/xml"/>'
        f'</opf:manifest>'
        f'<opf:spine>'
        f'<opf:itemref idref="header"/>'
        + ''.join(f'<opf:itemref idref="section{i}"/>' for i in range(section_count)) +
        f'</opf:spine>'
        f'</opf:package>'
    )
