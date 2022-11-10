/*
 * Copyright (C) 2022 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {TraceType} from "common/trace/trace_type";
import {View, Viewer, ViewType} from "viewers/viewer";
import {ViewerEvents} from "viewers/common/viewer_events";
import {PresenterInputMethod} from "viewers/common/presenter_input_method";
import {ImeUiData} from "viewers/common/ime_ui_data";

abstract class ViewerInputMethod implements Viewer {
  constructor() {
    this.htmlElement = document.createElement("viewer-input-method");
    this.presenter = this.initialisePresenter();
    this.addViewerEventListeners();
  }

  public notifyCurrentTraceEntries(entries: Map<TraceType, any>): void {
    this.presenter.notifyCurrentTraceEntries(entries);
  }

  public abstract getViews(): View[];
  public abstract getDependencies(): TraceType[];

  protected imeUiCallback = (uiData: ImeUiData) => {
    // Angular does not deep watch @Input properties. Clearing inputData to null before repopulating
    // automatically ensures that the UI will change via the Angular change detection cycle. Without
    // resetting, Angular does not auto-detect that inputData has changed.
    (this.htmlElement as any).inputData = null;
    (this.htmlElement as any).inputData = uiData;
  };

  protected addViewerEventListeners() {
    this.htmlElement.addEventListener(ViewerEvents.HierarchyPinnedChange, (event) => this.presenter.updatePinnedItems(((event as CustomEvent).detail.pinnedItem)));
    this.htmlElement.addEventListener(ViewerEvents.HighlightedChange, (event) => this.presenter.updateHighlightedItems(`${(event as CustomEvent).detail.id}`));
    this.htmlElement.addEventListener(ViewerEvents.HierarchyUserOptionsChange, (event) => this.presenter.updateHierarchyTree((event as CustomEvent).detail.userOptions));
    this.htmlElement.addEventListener(ViewerEvents.HierarchyFilterChange, (event) => this.presenter.filterHierarchyTree((event as CustomEvent).detail.filterString));
    this.htmlElement.addEventListener(ViewerEvents.PropertiesUserOptionsChange, (event) => this.presenter.updatePropertiesTree((event as CustomEvent).detail.userOptions));
    this.htmlElement.addEventListener(ViewerEvents.PropertiesFilterChange, (event) => this.presenter.filterPropertiesTree((event as CustomEvent).detail.filterString));
    this.htmlElement.addEventListener(ViewerEvents.SelectedTreeChange, (event) => this.presenter.newPropertiesTree((event as CustomEvent).detail.selectedItem));
    this.htmlElement.addEventListener(ViewerEvents.AdditionalPropertySelected, (event) => this.presenter.newAdditionalPropertiesTree((event as CustomEvent).detail.selectedItem));
  }

  protected abstract initialisePresenter(): PresenterInputMethod;

  protected htmlElement: HTMLElement;
  protected presenter: PresenterInputMethod;
}

export {ViewerInputMethod};
