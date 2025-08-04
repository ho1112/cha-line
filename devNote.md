1. 첫번째
✦ 물론입니다. 지금까지 진행한 작업과 현재 프로젝트의 완료 상태를 명확하게 정리해 드리겠습니다.

  무엇을 했는가? (What We've Done)

  1. 프로젝트 기반 구축
   * 사양서에 따라 Next.js를 기반으로 한 웹 애플리케이션 프로젝트를 생성했습니다.
   * 브라우저 자동화(playwright), LINE 알림(@line/bot-sdk), Google API 연동(googleapis) 등 프로젝트에 필요한 모든 핵심 라이브러리를 설치하고
     설정했습니다.

  2. 핵심 기능 코드 구현
   * 스크래핑 모듈 (`lib/scraper.js`): Playwright를 사용하여 SBI 증권 웹사이트에 로그인하고, 2단계 인증(2FA)을 처리한 후, 배당금 입금 내역을 가져오는
     로직을 완성했습니다.
   * 알림 모듈 (`lib/notification.js`): 스크래핑한 데이터나 처리 중 발생한 에러를 지정된 사용자에게 LINE 메시지로 전송하는 로직을 완성했습니다.
   * API 엔드포인트 (`pages/api/dividend-webhook.js`): 외부(LINE, Google Apps Script)의 요청을 받아 스크래핑과 알림 모듈을 순차적으로 실행시키는 메인
     컨트롤러를 구현했습니다.
   * 자동화 트리거 (`Code.gs`): 주기적으로 Gmail을 확인하여 조건에 맞는 새 메일이 오면 위에서 만든 API 엔드포인트를 호출하는 Google Apps Script 코드를
     작성했습니다.

  3. 사용자 요구사항 반영 및 사양 변경
   * AI 기능 제거: 사용자님의 요청에 따라, Gemini API를 이용한 AI 메시지 생성 기능을 완전히 제거했습니다. 현재는 고정된 텍스트 템플릿을 사용하여 알림을
     보냅니다.
   * Google 인증 방식 변경: 사용자의 이메일 계정이 일반 @gmail.com인 것을 확인하고, 기존의 서비스 계정 인증 방식에서 OAuth 2.0과 Refresh Token을 
     사용하는 방식으로 인증 로직을 전면 수정했습니다. 이를 위해 필요한 Google Cloud 설정 방법과 환경 변수를 새로 안내해 드렸습니다.

  4. 환경 변수 설정
   * SBI 계정 정보, LINE API 키, Google API 인증 정보 등 모든 민감한 정보를 안전하게 관리할 수 있도록 .env.local 파일의 구조를 잡고, 필요한 모든 변수
     항목을 정의했습니다.

  ---

  무엇이 완료된 상태인가? (Current Status)

   * 모든 코드 개발이 완료되었습니다.
   * 프로젝트는 사양서의 모든 핵심 기능과 사용자님의 추가 요구사항(AI 제거, 인증 방식 변경)을 반영하여 기능적으로 완성된 상태입니다.
   * 현재 코드는 로컬 환경에서 실행하거나 Vercel과 같은 클라우드 플랫폼에 배포할 준비가 된 상태입니다.

  요약하자면, 'cha-line' 봇의 소프트웨어(코드)는 완전히 완성되었습니다. 이제 이 소프트웨어를 실제 작동하도록 서버에 올리고(배포), 외부 서비스(LINE, 
  Google)와 연결하는 최종 설정 작업만 남았습니다.
  -----
++++ API 인증과정 메모
✦ 물론입니다. Google Cloud Platform에서 API를 활성화하고, 일반 @gmail.com 계정으로 cha-line 봇을 운영하기 위해 필요한 인증 정보를 생성했던 전 과정을
  다시 한번 상세히 정리해 드리겠습니다.

  이 내용을 그대로 복사해서 메모해두시면, 나중에 다른 프로젝트를 할 때도 유용하게 사용하실 수 있을 겁니다.

  ---

  Google Cloud Platform 설정 과정 요약 (OAuth 2.0 방식)

  이 문서는 Google Cloud Platform(GCP)에서 특정 애플리케이션(예: cha-line 봇)이 사용자의 개인 데이터(예: Gmail)에 안전하게 접근할 수 있도록 OAuth 2.0 
  인증 정보를 설정하는 과정을 기록합니다. 이 방식은 최종 사용자가 일반 @gmail.com 계정일 때 사용됩니다.

  핵심 목표는 다음 세 가지 정보를 얻는 것입니다.
   1. 클라이언트 ID (Client ID)
   2. 클라이언트 보안 비밀 (Client Secret)
   3. 갱신 토큰 (Refresh Token)

  ---

  1단계: Gmail API 활성화

  가장 먼저, 우리 프로젝트가 Gmail API를 사용할 수 있도록 권한을 켜야 합니다.

   1. Google Cloud Console에 접속합니다.
   2. 화면 왼쪽 상단의 탐색 메뉴(☰)를 클릭합니다.
   3. `API 및 서비스` > `라이브러리`로 이동합니다.
   4. 검색창에 Gmail API를 입력하여 검색한 뒤, 나타나는 Gmail API 카드를 클릭합니다.
   5. `사용 설정` 버튼을 눌러 API를 활성화합니다.

  ---

  2단계: OAuth 동의 화면 설정

  사용자가 우리 애플리케이션에 "내 Gmail 데이터를 읽어도 좋아"라고 동의할 때 보게 될 화면의 정보를 설정하는 과정입니다.

   1. 탐색 메뉴(☰) > `API 및 서비스` > `OAuth 동의 화면`으로 이동합니다.
   2. User Type으로 `외부`를 선택하고 `만들기`를 클릭합니다.
   3. 앱 정보를 입력합니다.
       * 앱 이름: cha-line-bot과 같이 사용자가 식별할 수 있는 이름을 입력합니다.
       * 사용자 지원 이메일: 본인의 Gmail 주소를 선택합니다.
       * 개발자 연락처 정보: 본인의 Gmail 주소를 입력하고 `저장 후 계속`을 클릭합니다.
   4. 범위를 설정합니다.
       * `+ 범위 추가 또는 삭제` 버튼을 클릭합니다.
       * 검색창에 gmail.readonly를 입력하고, 나타나는 https://www.googleapis.com/auth/gmail.readonly 범위를 체크한 후 `업데이트` 버튼을 누릅니다. (이는
         "읽기 전용" 권한만 요청하겠다는 의미입니다.)
       * `저장 후 계속`을 클릭합니다.
   5. 테스트 사용자를 추가합니다.
       * 앱이 "테스트" 상태일 때는 여기에 등록된 사용자만 인증을 시도할 수 있습니다.
       * `+ ADD USERS` 버튼을 누르고, SBI 증권 메일을 받는 본인의 @gmail.com 주소를 추가합니다.
       * `저장 후 계속`을 클릭하여 동의 화면 설정을 마칩니다.

  ---

  3단계: 사용자 인증 정보 생성 (클라이언트 ID, 시크릿 발급)

  이제 우리 애플리케이션을 Google에 식별시킬 클라이언트 ID와 클라이언트 보안 비밀을 발급받습니다.

   1. 탐색 메뉴(☰) > `API 및 서비스` > `사용자 인증 정보`로 이동합니다.
   2. 화면 상단의 `+ 사용자 인증 정보 만들기`를 클릭하고 `OAuth 클라이언트 ID`를 선택합니다.
   3. 애플리케이션 유형으로 `웹 애플리케이션`을 선택합니다.
   4. 승인된 리디렉션 URI 섹션에서 `+ URI 추가` 버튼을 클릭하고, 다음 주소를 정확히 입력합니다.
       * https://developers.google.com/oauthplayground
       * (이 주소는 4단계에서 Refresh Token을 안전하게 발급받기 위해 사용할 Google의 공식 도구입니다.)
   5. `만들기` 버튼을 클릭합니다.
   6. 생성이 완료되면 `클라이언트 ID`와 `클라이언트 보안 비밀`이 표시됩니다. 이 두 값을 복사하여 .env.local 파일의 GOOGLE_CLIENT_ID와
      GOOGLE_CLIENT_SECRET 변수에 각각 저장합니다.

  ---

  4단계: 갱신 토큰(Refresh Token) 발급

  사용자가 매번 로그인할 필요 없이, 우리 애플리케이션이 지속적으로 데이터를 요청할 수 있게 해주는 Refresh Token을 발급받는, 단 한 번만 수행하는
  과정입니다.

   1. Google OAuth Playground (https://developers.google.com/oauthplayground)로 이동합니다.
   2. 오른쪽 상단의 톱니바퀴 아이콘(⚙️)을 클릭합니다.
   3. `Use your own OAuth credentials` 체크박스를 선택합니다.
   4. 3단계에서 발급받은 `OAuth Client ID`와 `OAuth Client Secret`을 각각 입력하고 창을 닫습니다.
   5. 화면 왼쪽의 Step 1: Select & authorize APIs 영역에서, Gmail API v1을 찾아 https://www.googleapis.com/auth/gmail.readonly 범위를 선택합니다.
   6. `Authorize APIs` 버튼을 클릭하면 Google 로그인 및 동의 화면 팝업이 나타납니다.
   7. 본인의 @gmail.com 계정으로 로그인하고, "cha-line-bot이 내 Gmail 메시지를 볼 수 있도록 허용"하는 것에 동의합니다.
   8. Step 2: Exchange authorization code for tokens 화면으로 자동 리디렉션되면, `Exchange authorization code for tokens` 버튼을 클릭합니다.
   9. 요청 결과로 `Refresh token`이 표시됩니다. 이 값을 복사하여 .env.local 파일의 GOOGLE_REFRESH_TOKEN 변수에 저장합니다.

  이 4단계를 모두 마치면, 애플리케이션이 사용자를 대신하여 Gmail 데이터를 안전하게 읽어올 모든 준비가 완료됩니다.
  ----------

2. 두번째
