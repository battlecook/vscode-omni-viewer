import { ColorUtils } from '../utils/ColorUtils.js';

/**
 * 속성 패널 관리 클래스
 * 편집 요소의 속성 패널 표시 및 업데이트를 담당
 */
export class PropertiesPanel {
    constructor() {
        this.editProperties = document.getElementById('editProperties');
        this.shapeColor = document.getElementById('shapeColor');
        this.borderColor = document.getElementById('borderColor');
        this.fillOpacity = document.getElementById('fillOpacity');
        this.borderOpacity = document.getElementById('borderOpacity');
        this.fillOpacityValue = document.getElementById('fillOpacityValue');
        this.borderOpacityValue = document.getElementById('borderOpacityValue');
        this.shapeSize = document.getElementById('shapeSize');
        this.textInput = document.getElementById('textInput');
        this.fontSize = document.getElementById('fontSize');
        this.fontSizeInput = document.getElementById('fontSizeInput');
    }
    
    /**
     * 속성 패널 표시/숨김
     * @param {boolean} show - 표시 여부
     */
    show(show = true) {
        if (this.editProperties) {
            this.editProperties.style.display = show ? 'flex' : 'none';
        }
    }
    
    /**
     * 선택된 요소들의 속성으로 패널 업데이트
     * @param {Object[]} selectedElements - 선택된 요소들
     */
    updateProperties(selectedElements) {
        if (selectedElements.length === 0) {
            this.show(false);
            return;
        }
        
        // 속성 그룹 표시/숨김 설정
        this.updatePropertyGroups(selectedElements);
        
        // 공통 속성 계산
        const displayProperties = this.calculateCommonProperties(selectedElements);
        
        // 값 업데이트
        this.updatePropertyValues(displayProperties);
        
        this.show(true);
    }
    
    /**
     * 속성 그룹 표시/숨김 업데이트
     * @param {Object[]} selectedElements - 선택된 요소들
     */
    updatePropertyGroups(selectedElements) {
        const propertyGroups = this.editProperties.querySelectorAll('.property-group');
        
        propertyGroups.forEach(group => {
            const fillColorInput = group.querySelector('input[type="color"][id="shapeColor"]');
            const borderColorInput = group.querySelector('input[type="color"][id="borderColor"]');
            const borderOpacityInput = group.querySelector('input[type="range"][id="borderOpacity"]');
            const textInput = group.querySelector('input[type="text"]');
            const fontSizeInput = group.querySelector('input[type="range"][id="fontSize"]');
            
            if (fillColorInput) {
                // 항상 표시
                group.style.display = 'flex';
            } else if (borderColorInput || borderOpacityInput) {
                // 비텍스트 요소가 있거나 혼합 선택인 경우 표시
                const hasTextElements = selectedElements.some(el => el.type === 'text');
                const hasNonTextElements = selectedElements.some(el => el.type !== 'text');
                group.style.display = (hasNonTextElements || (hasTextElements && hasNonTextElements)) ? 'flex' : 'none';
            } else if (textInput || fontSizeInput) {
                // 텍스트 요소가 있는 경우 표시
                const hasTextElements = selectedElements.some(el => el.type === 'text');
                group.style.display = hasTextElements ? 'flex' : 'none';
            }
        });
    }
    
    /**
     * 공통 속성 계산
     * @param {Object[]} selectedElements - 선택된 요소들
     * @returns {Object} 표시할 속성들
     */
    calculateCommonProperties(selectedElements) {
        if (selectedElements.length === 1) {
            // 단일 선택 시 해당 요소의 속성 사용
            const element = selectedElements[0];
            return {
                color: element.color,
                borderColor: element.borderColor || '#000000',
                fillOpacity: element.fillOpacity !== undefined ? element.fillOpacity : 100,
                borderOpacity: element.borderOpacity !== undefined ? element.borderOpacity : 100,
                size: element.size,
                text: element.text || '',
                fontSize: element.fontSize || 24
            };
        }
        
        // 다중 선택 시 공통 속성 계산
        const colors = selectedElements.map(el => el.color);
        const borderColors = selectedElements.map(el => el.borderColor || '#000000');
        const fillOpacities = selectedElements.map(el => el.fillOpacity !== undefined ? el.fillOpacity : 100);
        const borderOpacities = selectedElements.map(el => el.borderOpacity !== undefined ? el.borderOpacity : 100);
        const sizes = selectedElements.map(el => el.size);
        const texts = selectedElements.map(el => el.text || '');
        const fontSizes = selectedElements.map(el => el.fontSize || 24);
        
        return {
            color: ColorUtils.getCommonColor(colors),
            borderColor: ColorUtils.getCommonColor(borderColors),
            fillOpacity: this.getCommonValue(fillOpacities),
            borderOpacity: this.getCommonValue(borderOpacities),
            size: this.getCommonValue(sizes),
            text: this.getCommonText(texts),
            fontSize: this.getCommonValue(fontSizes)
        };
    }
    
    /**
     * 공통 값 계산 (숫자)
     * @param {number[]} values - 값 배열
     * @returns {number} 공통 값 또는 평균값
     */
    getCommonValue(values) {
        if (values.length === 0) return 0;
        if (values.length === 1) return values[0];
        
        const allSame = values.every(value => value === values[0]);
        return allSame ? values[0] : Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    }
    
    /**
     * 공통 텍스트 계산
     * @param {string[]} texts - 텍스트 배열
     * @returns {string} 공통 텍스트 또는 'mixed'
     */
    getCommonText(texts) {
        if (texts.length === 0) return '';
        if (texts.length === 1) return texts[0];
        
        const allSame = texts.every(text => text === texts[0]);
        return allSame ? texts[0] : 'mixed';
    }
    
    /**
     * 속성 값들 업데이트
     * @param {Object} properties - 표시할 속성들
     */
    updatePropertyValues(properties) {
        if (this.shapeColor) {
            this.shapeColor.value = properties.color === 'mixed' ? '#ff0000' : properties.color;
        }
        if (this.borderColor) {
            this.borderColor.value = properties.borderColor === 'mixed' ? '#000000' : properties.borderColor;
        }
        if (this.fillOpacity) {
            this.fillOpacity.value = properties.fillOpacity;
            if (this.fillOpacityValue) {
                this.fillOpacityValue.textContent = properties.fillOpacity + '%';
            }
        }
        if (this.borderOpacity) {
            this.borderOpacity.value = properties.borderOpacity;
            if (this.borderOpacityValue) {
                this.borderOpacityValue.textContent = properties.borderOpacity + '%';
            }
        }
        if (this.shapeSize) {
            this.shapeSize.value = properties.size;
        }
        if (this.textInput) {
            this.textInput.value = properties.text === 'mixed' ? '' : properties.text;
        }
        if (this.fontSize) {
            this.fontSize.value = properties.fontSize;
            if (this.fontSizeInput) {
                this.fontSizeInput.value = properties.fontSize;
            }
        }
    }
    
    /**
     * 현재 속성 값들 반환
     * @returns {Object} 현재 속성 값들
     */
    getCurrentProperties() {
        return {
            color: this.shapeColor ? this.shapeColor.value : '#ff0000',
            borderColor: this.borderColor ? this.borderColor.value : '#000000',
            fillOpacity: this.fillOpacity ? parseInt(this.fillOpacity.value) : 100,
            borderOpacity: this.borderOpacity ? parseInt(this.borderOpacity.value) : 100,
            size: this.shapeSize ? parseInt(this.shapeSize.value) : 100,
            text: this.textInput ? this.textInput.value : '',
            fontSize: this.fontSize ? parseInt(this.fontSize.value) : 24
        };
    }
    
    /**
     * 속성 변경 이벤트 리스너 설정
     * @param {Function} onPropertyChange - 속성 변경 콜백
     */
    setupEventListeners(onPropertyChange) {
        const inputs = [
            this.shapeColor,
            this.borderColor,
            this.fillOpacity,
            this.borderOpacity,
            this.shapeSize,
            this.textInput,
            this.fontSize,
            this.fontSizeInput
        ];
        
        inputs.forEach(input => {
            if (input) {
                const eventType = input.type === 'range' ? 'input' : 'change';
                input.addEventListener(eventType, (e) => {
                    // 슬라이더 값 표시 업데이트
                    if (input === this.fillOpacity && this.fillOpacityValue) {
                        this.fillOpacityValue.textContent = e.target.value + '%';
                    }
                    if (input === this.borderOpacity && this.borderOpacityValue) {
                        this.borderOpacityValue.textContent = e.target.value + '%';
                    }
                    if (input === this.fontSize && this.fontSizeInput) {
                        this.fontSizeInput.value = e.target.value;
                    }
                    if (input === this.fontSizeInput && this.fontSize) {
                        this.fontSize.value = e.target.value;
                    }
                    
                    if (onPropertyChange) {
                        onPropertyChange();
                    }
                });
            }
        });
    }
}
