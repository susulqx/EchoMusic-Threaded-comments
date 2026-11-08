/**
 * 设置页组件。
 *
 * 用宿主的 Switch / Select / Slider 三个控件（经 ctx.ui.components 异步加载），
 * 与主程序设置页的观感保持一致。任何改动都会规整后写回 ctx.storage，
 * 并立刻刷新所有已展开的楼层。
 */

import {
  CONTAINER_HEIGHT_STEP,
  MAX_CONTAINER_HEIGHT,
  MIN_CONTAINER_HEIGHT,
  MODES,
  ROOTS_PER_PAGE,
  STORAGE_KEY,
} from "./constants.js";
import { refreshAllContainers } from "./container.js";
import { t } from "./i18n.js";
import { normalizeSettings } from "./settings.js";
import { getSettings } from "./runtime.js";

/** 模式下拉的选项；label 走 i18n，值保持不变（存进设置的是 value） */
export const modeOptions = () =>
  MODES.map((mode) => ({
    value: mode,
    label: t("settings.mode.option." + mode),
  }));

/**
 * @param {object} ctx 插件上下文
 * @param {(value: object) => void} onApply 设置写盘后的回调（由入口注入，便于单测替换）
 */
export const createSettingsComponent = (ctx) =>
  ctx.vue.defineComponent({
    name: "ThreadedCommentsSettings",
    setup() {
      const { computed, defineAsyncComponent, h } = ctx.vue;
      const Switch = defineAsyncComponent(ctx.ui.components.Switch);
      const Select = defineAsyncComponent(ctx.ui.components.Select);
      const Slider = defineAsyncComponent(ctx.ui.components.Slider);

      const settings = computed(getSettings);

      const patch = (value) => {
        const next = normalizeSettings({ ...getSettings(), ...value });
        Object.assign(getSettings(), next);
        void Promise.resolve(ctx.storage.set(STORAGE_KEY, next)).catch((error) => {
          ctx.toast.warning(
            t("toast.saveFailed", {
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        });
        refreshAllContainers();
      };

      const field = (label, description, control) =>
        h("div", { class: "echo-tc-field" }, [
          h("span", { class: "echo-tc-copy" }, [
            h("span", { class: "echo-tc-label" }, label),
            description ? h("span", { class: "echo-tc-desc" }, description) : null,
          ]),
          h("span", { class: "echo-tc-control" }, control),
        ]);

      const switchField = (key, current, onPatch) =>
        field(
          t("settings." + key + ".label"),
          t("settings." + key + ".desc"),
          h(Switch, {
            modelValue: current,
            "onUpdate:modelValue": (value) => patch(onPatch(Boolean(value))),
          }),
        );

      return () =>
        h("div", { class: "echo-tc-settings" }, [
          switchField("enabled", settings.value.enabled, (value) => ({ enabled: value })),

          settings.value.enabled
            ? switchField("container", settings.value.container, (value) => ({ container: value }))
            : null,

          settings.value.enabled && settings.value.container
            ? field(
                t("settings.containerHeight.label"),
                t("settings.containerHeight.desc", {
                  min: MIN_CONTAINER_HEIGHT,
                  max: MAX_CONTAINER_HEIGHT,
                }),
                h(Slider, {
                  modelValue: settings.value.containerHeight,
                  min: MIN_CONTAINER_HEIGHT,
                  max: MAX_CONTAINER_HEIGHT,
                  step: CONTAINER_HEIGHT_STEP,
                  showValue: true,
                  valueSuffix: "px",
                  "onUpdate:modelValue": (value) => patch({ containerHeight: Number(value) }),
                }),
              )
            : null,

          settings.value.enabled
            ? field(
                t("settings.mode.label"),
                t("settings.mode.hint." + settings.value.mode),
                h(Select, {
                  modelValue: settings.value.mode,
                  options: modeOptions(),
                  "onUpdate:modelValue": (value) => patch({ mode: String(value) }),
                }),
              )
            : null,

          settings.value.enabled
            ? field(
                t("settings.paginate.label"),
                t("settings.paginate.desc", { perPage: ROOTS_PER_PAGE }),
                h(Switch, {
                  modelValue: settings.value.paginate,
                  "onUpdate:modelValue": (value) => patch({ paginate: Boolean(value) }),
                }),
              )
            : null,

          h("p", { class: "echo-tc-note" }, t("settings.note")),
        ]);
    },
  });
