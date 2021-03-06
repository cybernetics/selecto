import Component from "@egjs/component";
import Dragger, { OnDrag } from "@daybrush/drag";
import { InjectResult } from "css-styled";
import { Properties } from "framework-utils";
import { isObject, camelize, IObject, addEvent, removeEvent, isArray } from "@daybrush/utils";
import ChildrenDiffer, { diff, ChildrenDiffResult } from "@egjs/children-differ";
import DragScroll from "@scena/dragscroll";
import KeyController, { getCombi } from "keycon";
import { createElement, h, getClient, diffValue, getRect } from "./utils";
import { SelectoOptions, Rect, SelectoProperties, OnDragEvent, SelectoEvents } from "./types";
import { PROPERTIES, injector, CLASS_NAME } from "./consts";

/**
 * Selecto.js is a component that allows you to select elements in the drag area using the mouse or touch.
 * @sort 1
 * @extends eg.Component
 */
@Properties(PROPERTIES as any, (prototype, property) => {
    const attributes: IObject<any> = {
        enumerable: true,
        configurable: true,
        get() {
            return this.options[property];
        },
    };
    const setter = camelize(`set ${property}`);
    if (prototype[setter]) {
        attributes.set = function set(value) {
            this[setter](value);
        };
    } else {
        attributes.set = function set(value) {
            this.options[property] = value;
        };
    }
    Object.defineProperty(prototype, property, attributes);
})
class Selecto extends Component {
    public options: SelectoOptions;
    private target!: HTMLElement | SVGElement;
    private dragContainer!: Element | Window | Element[];
    private container!: HTMLElement;
    private dragger!: Dragger;
    private injectResult!: InjectResult;
    private selectedTargets: Array<HTMLElement | SVGElement> = [];
    private differ = new ChildrenDiffer<HTMLElement | SVGElement>();
    private dragScroll: DragScroll = new DragScroll();
    private keycon!: KeyController;
    /**
     *
     */
    constructor(
        options: Partial<SelectoOptions> = {},
    ) {
        super();
        this.target = options.target;
        this.container = options.container;
        this.options = {
            target: null,
            container: null,
            dragContainer: null,
            selectableTargets: [],
            selectByClick: true,
            selectFromInside: true,
            hitRate: 100,
            continueSelect: false,
            toggleContinueSelect: null,
            keyContainer: null,
            scrollOptions: undefined,
            checkInput: false,
            preventDefault: false,
            cspNonce: "",
            ratio: 0,
            ...options,
        };
        this.initElement();
        this.initDragScroll();
        this.setKeyController();
    }
    /**
     * You can set the currently selected targets.
     */
    public setSelectedTargets(selectedTargets: Array<HTMLElement | SVGElement>): this {
        this.selectedTargets = selectedTargets;
        this.differ = new ChildrenDiffer(selectedTargets);

        return this;
    }
    /**
     * You can get the currently selected targets.
     */
    public getSelectedTargets(): Array<HTMLElement | SVGElement> {
        return this.selectedTargets;
    }
    public setKeyContainer(keyContainer: HTMLElement | Document | Window) {
        const options = this.options;

        diffValue(options.keyContainer, keyContainer, () => {
            options.keyContainer = keyContainer;

            this.setKeyController();
        });
    }
    public setToggleContinueSelect(toggleContinueSelect: string[][] | string[] | string) {
        const options = this.options;

        diffValue(options.toggleContinueSelect, toggleContinueSelect, () => {
            options.toggleContinueSelect = toggleContinueSelect;

            this.setKeyEvent();
        });
    }
    public setPreventDefault(value: boolean) {
        this.dragger.options.preventDefault = value;
    }
    public setCheckInput(value: boolean) {
        this.dragger.options.checkInput = value;
    }
    /**
     * `OnDragStart` is triggered by an external event.
     * @param - external event
     * @example
     * import Selecto from "selecto";
     *
     * const selecto = new Selecto();
     *
     * window.addEventListener("mousedown", e => {
     *   selecto.triggerDragStart(e);
     * });
     */
    public triggerDragStart(e: MouseEvent | TouchEvent) {
        this.dragger.triggerDragStart(e);
        return this;
    }
    /**
     * Destroy elements, properties, and events.
     */
    public destroy(): void {
        this.off();
        this.keycon && this.keycon.destroy();
        this.dragger.unset();
        this.injectResult.destroy();
        removeEvent(document, "selectstart", this.onDocumentSelectStart);

        this.keycon = null;
        this.dragger = null;
        this.injectResult = null;
        this.target = null;
        this.container = null;
        this.options = null;
    }

    /**
     * External click or mouse events can be applied to the selecto.
     * @params - Extenal click or mouse event
     * @params - Specify the clicked target directly.
     */
    public clickTarget(e: MouseEvent | TouchEvent, clickedTarget?: Element): this {
        const { clientX, clientY } = getClient(e);
        const dragEvent: OnDragEvent = {
            datas: {},
            clientX,
            clientY,
            inputEvent: e,
        };
        if (this.onDragStart(dragEvent, clickedTarget)) {
            this.onDragEnd(dragEvent);
        }
        return this;
    }
    private setKeyController() {
        const { keyContainer, toggleContinueSelect } = this.options;

        if (this.keycon) {
            this.keycon.destroy();
            this.keycon = null;
        }
        if (toggleContinueSelect) {
            this.keycon = new KeyController(keyContainer || window);
            this.keycon.keydown(this.onKeyDown).keyup(this.onKeyUp).on("blur", this.onBlur);
        }
    }
    private setKeyEvent() {
        const { toggleContinueSelect } = this.options;
        if (!toggleContinueSelect || this.keycon) {
            return;
        }
        this.setKeyController();
    }
    private initElement() {
        this.target = createElement(
            <div className={CLASS_NAME}></div> as any,
            this.target,
            this.container,
        );

        const target = this.target;

        const { dragContainer, checkInput, preventDefault } = this.options;
        this.dragContainer = typeof dragContainer === "string"
            ? [].slice.call(document.querySelectorAll(dragContainer))
            : (this.options.dragContainer || this.target.parentNode as any);
        this.dragger = new Dragger(this.dragContainer, {
            container: window,
            checkInput,
            preventDefault,
            dragstart: this.onDragStart,
            drag: this.onDrag,
            dragend: this.onDragEnd,
        });
        addEvent(document, "selectstart", this.onDocumentSelectStart);

        this.injectResult = injector.inject(target, {
            nonce: this.options.cspNonce,
        });
    }
    private hitTest(
        selectRect: Rect,
        clientX: number,
        clientY: number,
        targets: Array<HTMLElement | SVGElement>,
        rects: Rect[],
    ) {
        const { hitRate, selectByClick } = this.options;
        const { left, top, right, bottom } = selectRect;

        return targets.filter((target, i) => {
            const {
                left: rectLeft,
                top: rectTop,
                right: rectRight,
                bottom: rectBottom,
            } = rects[i];
            const isStart
                = rectLeft <= clientX
                && clientX <= rectRight
                && rectTop <= clientY
                && clientY <= rectBottom;
            const rectSize = (rectRight - rectLeft) * (rectBottom - rectTop);
            const testLeft = Math.max(rectLeft, left);
            const testRight = Math.min(rectRight, right);
            const testTop = Math.max(rectTop, top);
            const testBottom = Math.min(rectBottom, bottom);

            if (selectByClick && isStart) {
                return true;
            }
            if (testRight < testLeft || testBottom < testTop) {
                return false;
            }
            const rate = Math.round((testRight - testLeft) * (testBottom - testTop) / rectSize * 100);

            if (rate >= hitRate) {
                return true;
            }
            return false;
        });
    }
    private initDragScroll() {
        this.dragScroll.on("scroll", ({ container, direction }) => {
            this.trigger("scroll", {
                container,
                direction,
            });
        }).on("move", ({ offsetX, offsetY, inputEvent }) => {
            const datas = inputEvent.datas;
            datas.startX -= offsetX;
            datas.startY -= offsetY;
            datas.selectableRects.forEach(rect => {
                rect.top -= offsetY;
                rect.bottom -= offsetY;
                rect.left -= offsetX;
                rect.right -= offsetX;
            });
            this.dragger.scrollBy(offsetX, offsetY, inputEvent.inputEvent, false);

            inputEvent.distX += offsetX;
            inputEvent.distY += offsetY;
            this.check(inputEvent);
        });
    }
    private getSelectableTargets() {
        const selectableTargets: Array<HTMLElement | SVGElement> = [];

        this.options.selectableTargets.forEach(target => {
            if (isObject(target)) {
                selectableTargets.push(target);
            } else {
                const elements = [].slice.call(document.querySelectorAll(target));

                elements.forEach(el => {
                    selectableTargets.push(el);
                });
            }
        });

        return selectableTargets;
    }
    private passSelectedTargets(passedTargets: Array<HTMLElement | SVGElement>) {
        const {
            list,
            prevList,
            added,
            removed,
        } = diff(this.selectedTargets, passedTargets) as ChildrenDiffResult<HTMLElement | SVGElement>;

        return added.map(index => list[index]).concat(removed.map(index => prevList[index]));
    }
    private select(
        selectedTargets: Array<HTMLElement | SVGElement>, rect: Rect, inputEvent: any, isStart?: boolean) {
        const {
            added,
            removed,
            prevList,
            list,
        } = this.differ.update(selectedTargets);

        if (isStart) {
            /**
             * When the select(drag) starts, the selectStart event is called.
             * @memberof Selecto
             * @event selectStart
             * @param {Selecto.OnSelect} - Parameters for the selectStart event
             * @example
             * import Selecto from "selecto";
             *
             * const selecto = new Selecto({
             *   container: document.body,
             *   selectByClick: true,
             *   selectFromInside: false,
             * });
             *
             * selecto.on("selectStart", e => {
             *   e.added.forEach(el => {
             *     el.classList.add("selected");
             *   });
             *   e.removed.forEach(el => {
             *     el.classList.remove("selected");
             *   });
             * }).on("selectEnd", e => {
             *   e.afterAdded.forEach(el => {
             *     el.classList.add("selected");
             *   });
             *   e.afterRemoved.forEach(el => {
             *     el.classList.remove("selected");
             *   });
             * });
             */
            this.trigger("selectStart", {
                selected: selectedTargets,
                added: added.map(index => list[index]),
                removed: removed.map(index => prevList[index]),
                rect,
                inputEvent,
            });
        }
        if (added.length || removed.length) {
            /**
             * When the select in real time, the select event is called.
             * @memberof Selecto
             * @event select
             * @param {Selecto.OnSelect} - Parameters for the select event
             * @example
             * import Selecto from "selecto";
             *
             * const selecto = new Selecto({
             *   container: document.body,
             *   selectByClick: true,
             *   selectFromInside: false,
             * });
             *
             * selecto.on("select", e => {
             *   e.added.forEach(el => {
             *     el.classList.add("selected");
             *   });
             *   e.removed.forEach(el => {
             *     el.classList.remove("selected");
             *   });
             * });
             */
            this.trigger("select", {
                selected: selectedTargets,
                added: added.map(index => list[index]),
                removed: removed.map(index => prevList[index]),
                rect,
                inputEvent,
            });
        }
    }
    private selectEnd(
        startSelectedTargets: Array<HTMLElement | SVGElement>,
        selectedTargets: Array<HTMLElement | SVGElement>,
        rect: Rect,
        e: OnDragEvent,
    ) {
        const { inputEvent, isDouble } = e;
        const {
            added,
            removed,
            prevList,
            list,
        } = diff(startSelectedTargets, selectedTargets);
        const {
            added: afterAdded,
            removed: afterRemoved,
            prevList: afterPrevList,
            list: afterList,
        } = diff(this.selectedTargets, selectedTargets);
        const type = inputEvent.type;
        const isDragStart = type === "mousedown" || type === "touchstart";

        /**
         * When the select(dragEnd or click) ends, the selectEnd event is called.
         * @memberof Selecto
         * @event selectEnd
         * @param {Selecto.OnSelectEnd} - Parameters for the selectEnd event
         * @example
         * import Selecto from "selecto";
         *
         * const selecto = new Selecto({
         *   container: document.body,
         *   selectByClick: true,
         *   selectFromInside: false,
         * });
         *
         * selecto.on("selectStart", e => {
         *   e.added.forEach(el => {
         *     el.classList.add("selected");
         *   });
         *   e.removed.forEach(el => {
         *     el.classList.remove("selected");
         *   });
         * }).on("selectEnd", e => {
         *   e.afterAdded.forEach(el => {
         *     el.classList.add("selected");
         *   });
         *   e.afterRemoved.forEach(el => {
         *     el.classList.remove("selected");
         *   });
         * });
         */
        this.trigger("selectEnd", {
            selected: selectedTargets,
            added: added.map(index => list[index]),
            removed: removed.map(index => prevList[index]),
            afterAdded: afterAdded.map(index => afterList[index]),
            afterRemoved: afterRemoved.map(index => afterPrevList[index]),
            isDragStart,
            isDouble: !!isDouble,
            rect,
            inputEvent,
        });
    }
    private onDragStart = (e: OnDragEvent, clickedTarget?: Element) => {
        const { datas, clientX, clientY, inputEvent } = e;
        const { continueSelect, selectFromInside, selectByClick } = this.options;
        const selectableTargets = this.getSelectableTargets();
        const selectableRects = selectableTargets.map(target => {
            const rect = target.getBoundingClientRect();
            const { left, top, width, height } = rect;

            return {
                left,
                top,
                right: left + width,
                bottom: top + height,
                width,
                height,
            };
        });
        datas.selectableTargets = selectableTargets;
        datas.selectableRects = selectableRects;
        datas.startSelectedTargets = this.selectedTargets;
        const hitRect = {
            left: clientX,
            top: clientY,
            right: clientX,
            bottom: clientY,
            width: 0,
            height: 0,
        };
        let firstPassedTargets: Array<HTMLElement | SVGElement> = [];
        if (selectFromInside || selectByClick) {
            let pointTarget
                = (clickedTarget || document.elementFromPoint(clientX, clientY)) as HTMLElement | SVGElement;

            while (pointTarget) {
                if (selectableTargets.indexOf(pointTarget as HTMLElement | SVGElement) > -1) {
                    break;
                }
                pointTarget = pointTarget.parentElement;
            }
            firstPassedTargets = pointTarget ? [pointTarget] : [];
        }
        const hasInsideTargets = firstPassedTargets.length > 0;
        const isPreventSelect = !selectFromInside && hasInsideTargets;

        if (isPreventSelect && !selectByClick) {
            return false;
        }
        const type = inputEvent.type;
        const isTrusted = type === "mousedown" || type === "touchstart";
        /**
         * When the drag starts, the dragStart event is called.
         * Call the stop () function if you have a specific element or don't want to raise a select
         * @memberof Selecto
         * @event dragStart
         * @param {OnDragStart} - Parameters for the dragStart event
         * @example
         * import Selecto from "selecto";
         *
         * const selecto = new Selecto({
         *   container: document.body,
         *   selectByClick: true,
         *   selectFromInside: false,
         * });
         *
         * selecto.on("dragStart", e => {
         *   if (e.inputEvent.target.tagName === "SPAN") {
         *     e.stop();
         *   }
         * }).on("select", e => {
         *   e.added.forEach(el => {
         *     el.classList.add("selected");
         *   });
         *   e.removed.forEach(el => {
         *     el.classList.remove("selected");
         *   });
         * });
         */
        const result = isTrusted ? this.trigger("dragStart", e) : true;

        if (!result) {
            return false;
        }

        if (!continueSelect) {
            this.selectedTargets = [];
        } else {
            firstPassedTargets = this.passSelectedTargets(firstPassedTargets);
        }

        this.select(firstPassedTargets, hitRect, inputEvent, true);
        datas.startX = clientX;
        datas.startY = clientY;
        datas.selectedTargets = firstPassedTargets;
        this.target.style.cssText
            += `left:0px;top:0px;transform: translate(${clientX}px, ${clientY}px)`;

        if (isPreventSelect && selectByClick) {
            this.onDragEnd(e);
            inputEvent.preventDefault();
            return false;
        } else {
            if (type === "touchstart") {
                inputEvent.preventDefault();
            }
            const { scrollOptions } = this.options;
            if (scrollOptions && scrollOptions.container) {
                this.dragScroll.dragStart(e, scrollOptions);
            }
            return true;
        }
    }
    private check(e: any) {
        const {
            datas,
            inputEvent,
        } = e;
        const rect = getRect(e, this.options.ratio);
        const {
            top,
            left,
            width,
            height,
        } = rect;
        this.target.style.cssText
            += `display: block;`
            + `left:0px;top:0px;`
            + `transform: translate(${left}px, ${top}px);`
            + `width:${width}px;height:${height}px;`;

        const passedTargets = this.hitTest(
            rect, datas.startX, datas.startY, datas.selectableTargets, datas.selectableRects);
        const selectedTargets = this.passSelectedTargets(passedTargets);

        this.trigger("drag", {
            ...e,
            rect,
        });
        this.select(selectedTargets, rect, inputEvent);
        datas.selectedTargets = selectedTargets;
    }
    private onDrag = (e: OnDrag) => {
        const { scrollOptions } = this.options;
        if (scrollOptions && scrollOptions.container) {
            if (this.dragScroll.drag(e, scrollOptions)) {
                return;
            }
        }
        this.check(e);
    }
    private onDragEnd = (e: OnDragEvent) => {
        const { datas } = e;
        const rect = getRect(e, this.options.ratio);
        this.dragScroll.dragEnd();
        this.target.style.cssText += "display: none;";
        this.trigger("dragEnd", {
            ...e,
            rect,
        });
        this.selectEnd(
            datas.startSelectedTargets, datas.selectedTargets, rect, e);
        this.selectedTargets = datas.selectedTargets;
    }
    private sameCombiKey(e: any, isKeyup?: boolean) {
        const toggleContinueSelect = [].concat(this.options.toggleContinueSelect);
        const combi = getCombi(e.inputEvent, e.key);
        const toggleKeys = (isArray(toggleContinueSelect[0]) ? toggleContinueSelect : [toggleContinueSelect]);

        if (isKeyup) {
            const singleKey = e.key;

            return toggleKeys.some(keys => keys.some(key => key === singleKey));
        }
        return toggleKeys.some(keys => keys.every(key => combi.indexOf(key) > -1));
    }
    private onKeyDown = (e: any) => {
        if (!this.sameCombiKey(e)) {
            return;
        }
        this.continueSelect = true;
        /**
         * When you keydown the key you specified in toggleContinueSelect, the keydown event is called.
         * @memberof Selecto
         * @event keydown
         * @example
         * import Selecto from "selecto";
         *
         * const selecto = new Selecto({
         *   container: document.body,
         *   toggleContinueSelect: "shift";
         *   keyContainer: window,
         * });
         *
         * selecto.on("keydown", () => {
         *   document.querySelector(".button").classList.add("selected");
         * }).on("keyup", () => {
         *   document.querySelector(".button").classList.remove("selected");
         * }).on("select", e => {
         *   e.added.forEach(el => {
         *     el.classList.add("selected");
         *   });
         *   e.removed.forEach(el => {
         *     el.classList.remove("selected");
         *   });
         * });
         */
        this.trigger("keydown", {});
    }
    private onKeyUp = (e: any) => {
        if (!this.sameCombiKey(e, true)) {
            return;
        }
        this.continueSelect = false;
        /**
         * When you keyup the key you specified in toggleContinueSelect, the keyup event is called.
         * @memberof Selecto
         * @event keyup
         * @example
         * import Selecto from "selecto";
         *
         * const selecto = new Selecto({
         *   container: document.body,
         *   toggleContinueSelect: "shift";
         *   keyContainer: window,
         * });
         *
         * selecto.on("keydown", () => {
         *   document.querySelector(".button").classList.add("selected");
         * }).on("keyup", () => {
         *   document.querySelector(".button").classList.remove("selected");
         * }).on("select", e => {
         *   e.added.forEach(el => {
         *     el.classList.add("selected");
         *   });
         *   e.removed.forEach(el => {
         *     el.classList.remove("selected");
         *   });
         * });
         */
        this.trigger("keyup", {});
    }
    private onBlur = () => {
        if (this.toggleContinueSelect && this.continueSelect) {
            this.trigger("keyup", {});
        }
    }
    private onDocumentSelectStart = (e: any) => {
        if (!this.dragger.isFlag()) {
            return;
        }
        let dragContainer = this.dragContainer;

        if (dragContainer === window) {
            dragContainer = document.documentElement;
        }
        const containers = dragContainer instanceof Element
            ? [dragContainer] : [].slice.call(dragContainer) as Element[];
        const target = e.target;

        containers.some(container => {
            if (container === target || container.contains(target)) {
                e.preventDefault();
                return true;
            }
        });
    }
}

interface Selecto extends Component, SelectoProperties {
    on<T extends keyof SelectoEvents>(eventName: T, handlerToAttach: (event: SelectoEvents[T]) => any): this;
    on(eventName: string, handlerToAttach: (event: { [key: string]: any }) => any): this;
    on(events: { [key: string]: (event: { [key: string]: any }) => any }): this;
}

export default Selecto;
