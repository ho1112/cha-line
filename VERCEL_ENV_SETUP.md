# Vercel 환경 변수 설정 가이드

## 새로운 아키텍처 변경사항

Vercel에서 스크래핑 로직을 제거하고, Render 스크래핑 서버를 호출하는 방식으로 변경되었습니다.

## 추가해야 할 환경 변수

Vercel 대시보드에서 다음 환경 변수를 추가해야 합니다:

```
RENDER_SCRAPER_URL=https://sbi-render-scraper.onrender.com/scrape
```

## 기존 환경 변수 (유지)
```