# zotero-math-tidy

[English](README.md) | 한국어

논문을 읽다가 "이 기호가 뭐였지?" 하고 앞으로 되돌아가지 않도록, 논문에 나오는 수학 기호를 한 번에 정리해 PDF 옆에 보여 주는 Zotero 플러그인입니다.

| 기호 | 의미 |
| --- | --- |
| X<sub>n</sub> | n번째 센서에서 들어온 데이터 |
| σ<sup>2</sup> | 관측 잡음의 분산 |

## 사용법

1. PDF를 열면 오른쪽 아이템 패널에 **기호표** 섹션이 생깁니다. (라이브러리에서 항목을 선택해도 보입니다.)
2. **분석**을 누르면 논문을 LLM에 보내 기호, 의미, 처음 정의된 위치를 받아 표로 정리합니다.
3. 결과는 저장되므로 다음에 열 때는 바로 보입니다. 검색창으로 기호나 의미를 걸러 볼 수 있습니다.
4. 표의 행을 클릭하면 PDF에서 그 기호가 처음 나온 곳으로 이동하고, 다시 클릭하면 다음 위치로 넘어갑니다.
5. 분석한 뒤에는 PDF 본문의 기호 위에 마우스를 올리면 뜻이 말풍선으로 뜹니다.

4와 5는 기호표를 PDF의 글자 정보와 맞춰 보는 방식입니다. 수식이 이미지로 들어간 경우나, 다른 글자와 붙어 쓰인 한 글자 기호(`Wx`의 `x`)는 찾지 못할 수 있습니다.

## 설정

Zotero 설정 → **Math Tidy**

- **플러그인 언어**: 영어, 한국어, 또는 Zotero와 동일.
- **설명 언어**: 비워 두면 플러그인 언어를 따르고, 원하는 언어를 직접 적을 수도 있습니다.
- **제공자**: Claude(Anthropic), GPT(OpenAI 호환), Gemini(Google). 쓰려는 제공자의 API 키를 입력합니다.
- **모델**: 드롭다운에서 고릅니다. API 키를 입력하면 제공자에게서 목록을 받아 오고, 설정 화면을 열 때마다 또는 **목록 새로고침**을 누를 때 갱신합니다.
- **Base URL**(GPT): 바꾸면 OpenRouter나 Ollama 같은 OpenAI 호환 서버에도 쓸 수 있습니다.
- **LLM에 보낼 내용**: *PDF 원본*은 수식을 정확히 읽습니다. *추출한 텍스트만*은 저렴하지만 추출된 텍스트에서는 수식이 깨져 있는 경우가 많습니다. 20MB가 넘는 PDF는 항상 텍스트로 보냅니다.

제공자 서버가 혼잡하거나 사용량 한도에 걸리면(HTTP 429, 503) 세 번 다시 시도한 뒤에 오류를 표시합니다.

API 키는 Zotero 프로필에 암호화되지 않은 채 저장되며, 논문은 선택한 제공자에게 전송됩니다. 기호표는 Zotero 데이터 폴더의 `math-tidy/`에 PDF별 JSON 파일로 저장됩니다.

## 설치

```powershell
.\build.ps1
```

`build/math-tidy.xpi`가 만들어집니다. Zotero의 도구 → 플러그인 → 톱니바퀴 → *Install Plugin From File…*에서 선택하세요. Zotero 7 이상이 필요하며, Zotero 9에서 개발하고 테스트했습니다.

## 개발

빌드 단계 없이 `addon/` 폴더가 그대로 플러그인입니다.

- `addon/bootstrap.js` — 진입점
- `addon/src/math-tidy.js` — 설정, 결과 저장, 분석 실행
- `addon/src/llm.js` — Claude / OpenAI 호환 / Gemini 호출
- `addon/src/section.js` — 아이템 패널의 기호표 섹션
- `addon/src/notation.js` — 기호 표기(첨자, LaTeX 변환)와 렌더링
- `addon/src/matcher.js` — PDF 쪽 글자에서 기호 위치 찾기
- `addon/src/reader.js` — 리더에서 기호로 이동, 마우스 올리면 뜻 표시 (리더 내부 구조에 의존)
- `addon/preferences.xhtml`, `addon/preferences.js`, `addon/prefs.js` — 설정 화면과 기본값
- `addon/locale/en-US/math-tidy-en.ftl`, `math-tidy-ko.ftl` — 영어와 한국어 문구

소스에서 바로 불러오려면 Zotero 프로필의 `extensions/` 폴더에 `math-tidy@meteor0108.github.io`라는 이름의 텍스트 파일을 만들고 `addon` 폴더의 절대 경로를 적은 뒤 Zotero를 다시 시작합니다.

## 라이선스

[MIT](LICENSE)
