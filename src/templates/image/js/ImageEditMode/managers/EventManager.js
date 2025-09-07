/**
 * 이벤트 관리 클래스
 * 키보드 이벤트 및 기타 이벤트 처리를 담당
 */
export class EventManager {
    constructor() {
        this.isEditMode = false;
    }
    
    /**
     * 편집 모드 설정
     * @param {boolean} enabled - 편집 모드 활성화 여부
     */
    setEditMode(enabled) {
        this.isEditMode = enabled;
    }
    
    /**
     * 키보드 이벤트 핸들러
     * @param {KeyboardEvent} e - 키보드 이벤트
     * @param {Object} callbacks - 콜백 함수들
     */
    handleKeyDown(e, callbacks = {}) {
        if (!this.isEditMode) return;
        
        // Delete 키 처리
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (callbacks.onDelete) {
                callbacks.onDelete();
            }
        }
        
        // Escape 키로 선택 해제
        if (e.key === 'Escape') {
            if (callbacks.onEscape) {
                callbacks.onEscape();
            }
        }
    }
    
    /**
     * 캔버스 클릭 이벤트 핸들러
     * @param {MouseEvent} e - 마우스 이벤트
     * @param {Object} callbacks - 콜백 함수들
     */
    handleCanvasClick(e, callbacks = {}) {
        if (!this.isEditMode) {
            if (callbacks.onLogMessage) {
                callbacks.onLogMessage('Edit mode not active');
            }
            return;
        }
        
        // 캔버스 위치 계산
        const canvasRect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - canvasRect.left;
        const y = e.clientY - canvasRect.top;
        
        // 캔버스 경계 확인
        if (x < 0 || x > canvasRect.width || y < 0 || y > canvasRect.height) {
            return;
        }
        
        const isMultiSelect = e.metaKey || e.ctrlKey;
        
        if (callbacks.onCanvasClick) {
            callbacks.onCanvasClick(x, y, isMultiSelect);
        }
    }
    
    /**
     * 전역 키보드 이벤트 리스너 설정
     * @param {Object} callbacks - 콜백 함수들
     */
    setupKeyboardListeners(callbacks = {}) {
        document.addEventListener('keydown', (e) => {
            this.handleKeyDown(e, callbacks);
        });
    }
    
    /**
     * 캔버스 이벤트 리스너 설정
     * @param {HTMLElement} canvas - 캔버스 요소
     * @param {Object} callbacks - 콜백 함수들
     */
    setupCanvasListeners(canvas, callbacks = {}) {
        if (canvas) {
            canvas.addEventListener('click', (e) => {
                this.handleCanvasClick(e, callbacks);
            });
        }
    }
    
    /**
     * 삭제 버튼 이벤트 리스너 설정
     * @param {HTMLElement} deleteBtn - 삭제 버튼
     * @param {Function} onDelete - 삭제 콜백
     */
    setupDeleteButtonListener(deleteBtn, onDelete) {
        if (deleteBtn && onDelete) {
            deleteBtn.addEventListener('click', onDelete);
        }
    }
    
    /**
     * 편집 모드 토글 이벤트 리스너 설정
     * @param {HTMLElement} toggleBtn - 토글 버튼
     * @param {HTMLElement} editControls - 편집 컨트롤
     * @param {Object} callbacks - 콜백 함수들
     */
    setupEditModeToggleListener(toggleBtn, editControls, callbacks = {}) {
        if (toggleBtn && editControls) {
            toggleBtn.addEventListener('click', () => {
                const isVisible = editControls.style.display !== 'none';
                editControls.style.display = isVisible ? 'none' : 'flex';
                toggleBtn.classList.toggle('active', !isVisible);
                
                if (!isVisible) {
                    // 편집 모드 활성화
                    if (callbacks.onEnableEditMode) {
                        callbacks.onEnableEditMode();
                    }
                } else {
                    // 편집 모드 비활성화
                    if (callbacks.onDisableEditMode) {
                        callbacks.onDisableEditMode();
                    }
                }
            });
        }
    }
}
