# 테스트 가이드

이 디렉토리는 VSCode Omni Viewer 확장의 유틸리티 클래스들에 대한 테스트를 포함합니다.

## 테스트 구조

```
src/__tests__/
├── setup.ts                    # Jest 설정 파일
├── utils/
│   ├── fileUtils.test.ts       # FileUtils 클래스 테스트
│   ├── templateUtils.test.ts   # TemplateUtils 클래스 테스트
│   ├── messageHandler.test.ts  # MessageHandler 클래스 테스트
│   └── integration.test.ts     # 통합 테스트
└── README.md                   # 이 파일
```

## 테스트 실행

### 모든 테스트 실행
```bash
npm test
```

### 테스트 감시 모드
```bash
npm run test:watch
```

### 커버리지 리포트 생성
```bash
npm run test:coverage
```

## 테스트 커버리지

각 유틸리티 클래스는 다음과 같은 영역을 테스트합니다:

### FileUtils
- ✅ MIME 타입 감지 (오디오, 비디오, 이미지)
- ✅ 파일을 base64 data URL로 변환
- ✅ 파일 크기 제한 검증 (50MB)
- ✅ 파일 크기 포맷팅
- ✅ 에러 처리

### TemplateUtils
- ✅ HTML 템플릿 로드 및 변수 치환
- ✅ 웹뷰 URI 변환
- ✅ 웹뷰 옵션 설정
- ✅ 에러 처리 및 로깅

### MessageHandler
- ✅ 웹뷰 메시지 처리 (log, error, info, warning)
- ✅ 커스텀 메시지 핸들러
- ✅ 메시지 전송
- ✅ 메시지 리스너 설정

### 통합 테스트
- ✅ 파일 처리 및 템플릿 생성 워크플로우
- ✅ 메시지 핸들링 통합
- ✅ 웹뷰 옵션 및 URI 처리
- ✅ 파일 크기 및 형식 검증
- ✅ 에러 처리 및 로깅

## 모킹 (Mocking)

테스트에서는 다음 모듈들을 모킹합니다:

- `fs` - 파일 시스템 작업
- `vscode` - VSCode API
- `console` - 로깅 함수들

## 테스트 작성 가이드

### 새로운 테스트 추가

1. **테스트 파일 생성**: `src/__tests__/utils/[className].test.ts`
2. **모듈 모킹**: 필요한 외부 의존성 모킹
3. **테스트 케이스 작성**: 각 메서드에 대한 단위 테스트
4. **에러 케이스 테스트**: 예외 상황 처리 검증
5. **통합 테스트**: 여러 클래스 간 상호작용 테스트

### 테스트 패턴

```typescript
describe('ClassName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('methodName', () => {
    it('should do something when condition', () => {
      // Arrange
      const input = 'test';
      
      // Act
      const result = ClassName.methodName(input);
      
      // Assert
      expect(result).toBe('expected');
    });

    it('should handle error case', async () => {
      // Arrange
      const error = new Error('Test error');
      mockFunction.mockRejectedValue(error);
      
      // Act & Assert
      await expect(ClassName.methodName()).rejects.toThrow('Test error');
    });
  });
});
```

## 커버리지 목표

- **라인 커버리지**: 90% 이상
- **브랜치 커버리지**: 85% 이상
- **함수 커버리지**: 95% 이상

## 문제 해결

### 테스트가 실패하는 경우

1. **모킹 확인**: 외부 의존성이 올바르게 모킹되었는지 확인
2. **비동기 처리**: `async/await` 사용 확인
3. **타입 체크**: TypeScript 타입 오류 확인
4. **Jest 설정**: `jest.config.js` 설정 확인

### 일반적인 문제들

- **VSCode API 모킹**: `vscode` 모듈이 올바르게 모킹되었는지 확인
- **파일 시스템 모킹**: `fs.promises.readFile` 모킹 확인
- **비동기 테스트**: `done` 콜백 또는 Promise 반환 확인
