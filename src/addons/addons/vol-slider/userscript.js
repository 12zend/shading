import { setup, setVolume, onVolumeChanged, getVolume, setMuted, setUnmutedVolume, isMuted } from "./module.js";
import addSmallStageClass from "../../libraries/common/cs/small-stage.js";

export default async function ({ addon, console }) {
  const vm = addon.tab.traps.vm;
  setup(vm);

  const icon = document.createElement("button");
  icon.className = "sa-vol-slider-icon";
  icon.type = "button";
  icon.addEventListener("click", () => {
    setMuted(!isMuted());
  });

  const updateIcon = () => {
    const newVolume = getVolume();
    if (newVolume === 0) {
      icon.dataset.icon = "mute";
      icon.ariaLabel = "Unmute project";
    } else if (newVolume < 0.5) {
      icon.dataset.icon = "quiet";
      icon.ariaLabel = "Mute project";
    } else {
      icon.dataset.icon = "loud";
      icon.ariaLabel = "Mute project";
    }
    icon.title = icon.ariaLabel;
  };
  onVolumeChanged(updateIcon);

  const slider = document.createElement("input");
  slider.className = "sa-vol-slider-input";
  slider.type = "range";
  slider.min = 0;
  slider.max = 1;
  slider.step = 0.02;
  slider.ariaLabel = "Project volume";
  slider.title = "Project volume";
  slider.addEventListener("input", (e) => {
    setVolume(+e.target.value);
  });
  slider.addEventListener("change", (e) => {
    // Only commit unmute volume after the user finishes moving the slider
    if (!isMuted()) {
      setUnmutedVolume(getVolume());
    }
  });

  onVolumeChanged(() => {
    const newVolume = getVolume();
    if (newVolume !== +slider.value) {
      slider.value = newVolume;
    }
  });
  setVolume(addon.settings.get("defVol") / 100);

  const container = document.createElement("div");
  container.className = "sa-vol-slider sa-vol-slider--timeline";
  // Nested elements are needed for hover animation - see hover.css
  const innerContainer = document.createElement("div");
  innerContainer.className = "sa-vol-slider-inner";
  innerContainer.appendChild(icon);
  innerContainer.appendChild(slider);
  container.appendChild(innerContainer);
  addon.tab.displayNoneWhileDisabled(container, {
    display: "flex",
  });

  addSmallStageClass();

  addon.self.addEventListener("disabled", () => {
    setVolume(1);
  });

  addon.self.addEventListener("reenabled", () => {
    setVolume(addon.settings.get("defVol") / 100);
  });

  while (true) {
    await addon.tab.waitForElement("[data-movie-timeline-addons]", {
      markAsSeen: true,
      reduxEvents: ["scratch-gui/mode/SET_PLAYER", "fontsLoaded/SET_FONTS_LOADED", "scratch-gui/locales/SELECT_LOCALE"],
    });
    addon.tab.displayNoneWhileDisabled(container, { display: "flex" });
    addon.tab.appendToSharedSpace({ space: "timelineHeader", element: container, order: 0 });
  }
}
