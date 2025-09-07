import { DOMUtils } from '../utils/DOMUtils.js';

/**
 * 리사이즈 관리 클래스
 * 사각형 요소의 리사이즈 핸들 기능을 담당
 */
export class ResizeManager {
    constructor() {
        this.isResizing = false;
        this.startX = 0;
        this.startY = 0;
        this.startWidth = 0;
        this.startHeight = 0;
        this.startElementX = 0;
        this.startElementY = 0;
        this.currentElement = null;
        this.currentHandle = null;
    }
    
    /**
     * 리사이즈 핸들 추가
     * @param {HTMLElement} elementEl - 요소
     * @param {Object} element - 요소 데이터
     */
    addResizeHandles(elementEl, element) {
        const handles = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
        
        handles.forEach(handleType => {
            const handle = document.createElement('div');
            handle.className = `resize-handle ${handleType}`;
            handle.setAttribute('data-handle-type', handleType);
            handle.style.display = 'none'; // Initially hidden
            elementEl.appendChild(handle);
            
            // 리사이즈 기능 추가
            this.makeHandleResizable(handle, elementEl, element, handleType);
        });
    }
    
    /**
     * 핸들을 리사이즈 가능하게 설정
     * @param {HTMLElement} handle - 핸들 요소
     * @param {HTMLElement} elementEl - 요소
     * @param {Object} element - 요소 데이터
     * @param {string} handleType - 핸들 타입
     */
    makeHandleResizable(handle, elementEl, element, handleType) {
        DOMUtils.addEventListener(handle, 'mousedown', (e) => {
            this.startResizing(e, element, handleType);
        });
        
        DOMUtils.addEventListener(document, 'mousemove', (e) => {
            this.handleResizeMove(e);
        });
        
        DOMUtils.addEventListener(document, 'mouseup', () => {
            this.stopResizing();
        });
    }
    
    /**
     * 리사이즈 시작
     * @param {MouseEvent} e - 마우스 이벤트
     * @param {Object} element - 요소 데이터
     * @param {string} handleType - 핸들 타입
     */
    startResizing(e, element, handleType) {
        this.isResizing = true;
        this.startX = e.clientX;
        this.startY = e.clientY;
        
        // DOM 요소에서 실제 크기 가져오기
        const elementEl = DOMUtils.findElementById(element.id);
        if (elementEl) {
            const rect = elementEl.getBoundingClientRect();
            this.startWidth = rect.width;
            this.startHeight = rect.height;
        } else {
            // DOM 요소가 없으면 element.size 사용
            this.startWidth = element.size;
            this.startHeight = element.size;
        }
        
        this.startElementX = element.x;
        this.startElementY = element.y;
        this.currentElement = element;
        this.currentHandle = handleType;
        
        console.log('Resize started:', {
            startWidth: this.startWidth,
            startHeight: this.startHeight,
            elementSize: element.size
        });
        
        e.stopPropagation();
    }
    
    /**
     * 리사이즈 이동 처리
     * @param {MouseEvent} e - 마우스 이벤트
     */
    handleResizeMove(e) {
        if (!this.isResizing || !this.currentElement) return;
        
        const deltaX = e.clientX - this.startX;
        const deltaY = e.clientY - this.startY;
        
        const { newWidth, newHeight, newX, newY } = this.calculateNewSizeAndPosition(
            deltaX, deltaY, this.currentHandle
        );
        
        // 요소 업데이트
        this.currentElement.x = newX;
        this.currentElement.y = newY;
        
        // 사각형의 경우 width와 height 속성 업데이트
        if (this.currentElement.type === 'rectangle') {
            this.currentElement.width = newWidth;
            this.currentElement.height = newHeight;
            this.currentElement.size = newWidth; // size 속성은 너비 기준으로 유지 (호환성)
        } else {
            // 원형의 경우 size 속성만 업데이트
            this.currentElement.size = newWidth;
        }
        
        // 시각적 업데이트
        const elementEl = DOMUtils.findElementById(this.currentElement.id);
        if (elementEl) {
            DOMUtils.setSize(elementEl, newWidth, newHeight);
            DOMUtils.setPosition(elementEl, newX, newY);
        }
        
        console.log('Resize update:', {
            newWidth,
            newHeight,
            elementSize: this.currentElement.size
        });
    }
    
    /**
     * 새로운 크기와 위치 계산
     * @param {number} deltaX - X 방향 변화량
     * @param {number} deltaY - Y 방향 변화량
     * @param {string} handleType - 핸들 타입
     * @returns {Object} 새로운 크기와 위치
     */
    calculateNewSizeAndPosition(deltaX, deltaY, handleType) {
        let newWidth = this.startWidth;
        let newHeight = this.startHeight;
        let newX = this.startElementX;
        let newY = this.startElementY;
        
        const minSize = 20;
        
        switch (handleType) {
            case 'bottom-right':
                newWidth = Math.max(minSize, this.startWidth + deltaX);
                newHeight = Math.max(minSize, this.startHeight + deltaY);
                break;
            case 'bottom-left':
                newWidth = Math.max(minSize, this.startWidth - deltaX);
                newHeight = Math.max(minSize, this.startHeight + deltaY);
                newX = this.startElementX + (this.startWidth - newWidth);
                break;
            case 'top-right':
                newWidth = Math.max(minSize, this.startWidth + deltaX);
                newHeight = Math.max(minSize, this.startHeight - deltaY);
                newY = this.startElementY + (this.startHeight - newHeight);
                break;
            case 'top-left':
                newWidth = Math.max(minSize, this.startWidth - deltaX);
                newHeight = Math.max(minSize, this.startHeight - deltaY);
                newX = this.startElementX + (this.startWidth - newWidth);
                newY = this.startElementY + (this.startHeight - newHeight);
                break;
        }
        
        return { newWidth, newHeight, newX, newY };
    }
    
    /**
     * 리사이즈 중지
     */
    stopResizing() {
        this.isResizing = false;
        this.currentElement = null;
        this.currentHandle = null;
    }
    
    /**
     * 리사이즈 핸들 표시
     * @param {HTMLElement} elementEl - 요소
     */
    showResizeHandles(elementEl) {
        const handles = elementEl.querySelectorAll('.resize-handle');
        handles.forEach(handle => handle.style.display = 'block');
    }
    
    /**
     * 리사이즈 핸들 숨기기
     * @param {HTMLElement} elementEl - 요소
     */
    hideResizeHandles(elementEl) {
        const handles = elementEl.querySelectorAll('.resize-handle');
        handles.forEach(handle => handle.style.display = 'none');
    }
    
    /**
     * 리사이즈 상태 반환
     * @returns {boolean} 리사이즈 중 여부
     */
    isResizingActive() {
        return this.isResizing;
    }
}
