import { DOMUtils } from '../utils/DOMUtils.js';

/**
 * 드래그 앤 드롭 관리 클래스
 * 요소의 드래그 앤 드롭 기능을 담당
 */
export class DragDropManager {
    constructor(editCanvas, elementManager, selectionManager) {
        this.editCanvas = editCanvas;
        this.elementManager = elementManager;
        this.selectionManager = selectionManager;
        
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.initialPositions = [];
    }
    
    /**
     * 요소를 드래그 가능하게 설정
     * @param {HTMLElement} elementEl - DOM 요소
     * @param {Object} element - 요소 데이터
     */
    makeElementDraggable(elementEl, element) {
        DOMUtils.addEventListener(elementEl, 'mousedown', (e) => {
            if (this.selectionManager.getSelectedElements().some(el => el.id === element.id)) {
                this.startDragging(e, element);
            }
        });
        
        // 전역 마우스 이벤트 리스너
        DOMUtils.addEventListener(document, 'mousemove', (e) => {
            this.handleMouseMove(e);
        });
        
        DOMUtils.addEventListener(document, 'mouseup', () => {
            this.stopDragging();
        });
    }
    
    /**
     * 드래그 시작
     * @param {MouseEvent} e - 마우스 이벤트
     * @param {Object} element - 드래그할 요소
     */
    startDragging(e, element) {
        this.isDragging = true;
        this.startX = e.clientX - element.x;
        this.startY = e.clientY - element.y;
        
        // 다중 선택된 요소들의 초기 위치 저장
        const selectedElements = this.selectionManager.getSelectedElements();
        if (selectedElements.length > 1) {
            this.initialPositions = selectedElements.map(el => ({
                id: el.id,
                x: el.x,
                y: el.y
            }));
        }
        
        e.stopPropagation();
    }
    
    /**
     * 마우스 이동 처리
     * @param {MouseEvent} e - 마우스 이벤트
     */
    handleMouseMove(e) {
        if (!this.isDragging) return;
        
        const selectedElements = this.selectionManager.getSelectedElements();
        if (selectedElements.length === 0) return;
        
        const deltaX = e.clientX - this.startX - selectedElements[0].x;
        const deltaY = e.clientY - this.startY - selectedElements[0].y;
        
        if (selectedElements.length > 1) {
            // 다중 선택 시 모든 선택된 요소들을 함께 이동
            this.moveMultipleElements(selectedElements, deltaX, deltaY);
        } else {
            // 단일 선택 시 기존 로직
            this.moveSingleElement(selectedElements[0], e);
        }
    }
    
    /**
     * 단일 요소 이동
     * @param {Object} element - 이동할 요소
     * @param {MouseEvent} e - 마우스 이벤트
     */
    moveSingleElement(element, e) {
        element.x = e.clientX - this.startX;
        element.y = e.clientY - this.startY;
        
        const elementEl = DOMUtils.findElementById(element.id);
        if (elementEl) {
            DOMUtils.setPosition(elementEl, element.x, element.y);
        }
    }
    
    /**
     * 다중 요소 이동
     * @param {Object[]} elements - 이동할 요소들
     * @param {number} deltaX - X 방향 이동량
     * @param {number} deltaY - Y 방향 이동량
     */
    moveMultipleElements(elements, deltaX, deltaY) {
        elements.forEach(element => {
            const initialPos = this.initialPositions.find(pos => pos.id === element.id);
            if (initialPos) {
                element.x = initialPos.x + deltaX;
                element.y = initialPos.y + deltaY;
                
                const elementEl = DOMUtils.findElementById(element.id);
                if (elementEl) {
                    DOMUtils.setPosition(elementEl, element.x, element.y);
                }
            }
        });
    }
    
    /**
     * 드래그 중지
     */
    stopDragging() {
        this.isDragging = false;
        this.initialPositions = [];
    }
    
    /**
     * 텍스트 편집 모드 설정
     * @param {HTMLElement} elementEl - 텍스트 요소
     * @param {Object} element - 요소 데이터
     */
    makeTextEditable(elementEl, element) {
        elementEl.classList.add('editing');
        const input = document.createElement('input');
        input.type = 'text';
        input.value = element.text;
        input.style.fontSize = element.fontSize + 'px';
        input.style.color = element.color;
        
        input.addEventListener('blur', () => {
            element.text = input.value;
            elementEl.textContent = input.value;
            elementEl.classList.remove('editing');
            elementEl.removeChild(input);
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            }
        });
        
        elementEl.textContent = '';
        elementEl.appendChild(input);
        input.focus();
        input.select();
    }
    
    /**
     * 드래그 상태 반환
     * @returns {boolean} 드래그 중 여부
     */
    isDraggingActive() {
        return this.isDragging;
    }
}
