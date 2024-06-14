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

import {assertDefined} from 'common/assert_utils';
import {FunctionUtils} from 'common/function_utils';
import {PersistentStoreProxy} from 'common/persistent_store_proxy';
import {
  TabbedViewSwitchRequest,
  WinscopeEvent,
  WinscopeEventType,
} from 'messaging/winscope_event';
import {
  EmitEvent,
  WinscopeEventEmitter,
} from 'messaging/winscope_event_emitter';
import {LayerFlag} from 'parsers/surface_flinger/layer_flag';
import {CustomQueryType} from 'trace/custom_query';
import {Trace, TraceEntry} from 'trace/trace';
import {Traces} from 'trace/traces';
import {TraceEntryFinder} from 'trace/trace_entry_finder';
import {TraceType} from 'trace/trace_type';
import {EMPTY_OBJ_STRING} from 'trace/tree_node/formatters';
import {HierarchyTreeNode} from 'trace/tree_node/hierarchy_tree_node';
import {
  PropertySource,
  PropertyTreeNode,
} from 'trace/tree_node/property_tree_node';
import {TreeNode} from 'trace/tree_node/tree_node';
import {IsModifiedCallbackType} from 'viewers/common/add_diffs';
import {AddDiffsHierarchyTree} from 'viewers/common/add_diffs_hierarchy_tree';
import {AddDiffsPropertiesTree} from 'viewers/common/add_diffs_properties_tree';
import {VISIBLE_CHIP} from 'viewers/common/chip';
import {
  SfCuratedProperties,
  SfLayerSummary,
  SfSummaryProperty,
} from 'viewers/common/curated_properties';
import {DiffType} from 'viewers/common/diff_type';
import {DisplayIdentifier} from 'viewers/common/display_identifier';
import {AddChips} from 'viewers/common/operations/add_chips';
import {Filter} from 'viewers/common/operations/filter';
import {FlattenChildren} from 'viewers/common/operations/flatten_children';
import {SimplifyNames} from 'viewers/common/operations/simplify_names';
import {RectFilter} from 'viewers/common/rect_filter';
import {RectShowState} from 'viewers/common/rect_show_state';
import {UiHierarchyTreeNode} from 'viewers/common/ui_hierarchy_tree_node';
import {UiPropertyTreeNode} from 'viewers/common/ui_property_tree_node';
import {UI_RECT_FACTORY} from 'viewers/common/ui_rect_factory';
import {UiTreeFormatter} from 'viewers/common/ui_tree_formatter';
import {TreeNodeFilter, UiTreeUtils} from 'viewers/common/ui_tree_utils';
import {UserOptions} from 'viewers/common/user_options';
import {UiRect} from 'viewers/components/rects/types2d';
import {UiData} from './ui_data';

type NotifyViewCallbackType = (uiData: UiData) => void;

export class Presenter implements WinscopeEventEmitter {
  private readonly notifyViewCallback: NotifyViewCallbackType;
  private emitWinscopeEvent: EmitEvent = FunctionUtils.DO_NOTHING_ASYNC;
  private readonly traces: Traces;
  private readonly trace: Trace<HierarchyTreeNode>;
  private viewCapturePackageNames: string[] = [];
  private uiData: UiData;
  private hierarchyFilter: TreeNodeFilter = UiTreeUtils.makeIdFilter('');
  private propertiesFilter: TreeNodeFilter = UiTreeUtils.makePropertyFilter('');
  private highlightedItem = '';
  private highlightedProperty = '';
  private pinnedItems: UiHierarchyTreeNode[] = [];
  private pinnedIds: string[] = [];
  private selectedHierarchyTree: HierarchyTreeNode | undefined;
  private previousEntry: TraceEntry<HierarchyTreeNode> | undefined;
  private previousHierarchyTree: HierarchyTreeNode | undefined;
  private currentHierarchyTree: HierarchyTreeNode | undefined;
  private currentHierarchyTreeName: string | undefined;
  private allCurrentRects: UiRect[] = [];
  private rectFilter = new RectFilter();
  private rectsUserOptions: UserOptions = PersistentStoreProxy.new<UserOptions>(
    'SfRectsOptions',
    {
      ignoreNonHidden: {
        name: 'Ignore',
        icon: 'visibility',
        enabled: false,
      },
      showOnlyVisible: {
        name: 'Show only',
        chip: VISIBLE_CHIP,
        enabled: false,
      },
    },
    this.storage,
  );
  private hierarchyUserOptions: UserOptions =
    PersistentStoreProxy.new<UserOptions>(
      'SfHierarchyOptions',
      {
        showDiff: {
          name: 'Show diff', // TODO: PersistentStoreObject.Ignored("Show diff") or something like that to instruct to not store this info
          enabled: false,
          isUnavailable: false,
        },
        showOnlyVisible: {
          name: 'Show only',
          chip: VISIBLE_CHIP,
          enabled: false,
        },
        simplifyNames: {
          name: 'Simplify names',
          enabled: true,
        },
        flat: {
          name: 'Flat',
          enabled: false,
        },
      },
      this.storage,
    );

  private propertiesUserOptions: UserOptions =
    PersistentStoreProxy.new<UserOptions>(
      'SfPropertyOptions',
      {
        showDiff: {
          name: 'Show diff',
          enabled: false,
          isUnavailable: false,
        },
        showDefaults: {
          name: 'Show defaults',
          enabled: false,
          tooltip: `
                If checked, shows the value of all properties.
                Otherwise, hides all properties whose value is
                the default for its data type.
              `,
        },
      },
      this.storage,
    );

  constructor(
    trace: Trace<HierarchyTreeNode>,
    traces: Traces,
    private readonly storage: Storage,
    notifyViewCallback: NotifyViewCallbackType,
  ) {
    this.traces = traces;
    this.trace = trace;
    this.notifyViewCallback = notifyViewCallback;
    this.uiData = new UiData([TraceType.SURFACE_FLINGER]);
    this.copyUiDataAndNotifyView();
  }

  setEmitEvent(callback: EmitEvent) {
    this.emitWinscopeEvent = callback;
  }

  async onAppEvent(event: WinscopeEvent) {
    await event.visit(
      WinscopeEventType.TRACE_POSITION_UPDATE,
      async (event) => {
        await this.initializeIfNeeded();

        const entry = TraceEntryFinder.findCorrespondingEntry(
          this.trace,
          event.position,
        );
        this.currentHierarchyTree = await entry?.getValue();
        if (entry) {
          this.currentHierarchyTreeName = entry.getTimestamp().format();
        }

        this.previousEntry =
          entry && entry.getIndex() > 0
            ? this.trace.getEntry(entry.getIndex() - 1)
            : undefined;
        this.previousHierarchyTree = undefined;

        if (this.hierarchyUserOptions['showDiff'].isUnavailable !== undefined) {
          this.hierarchyUserOptions['showDiff'].isUnavailable =
            this.previousEntry === undefined;
        }
        if (
          this.propertiesUserOptions['showDiff'].isUnavailable !== undefined
        ) {
          this.propertiesUserOptions['showDiff'].isUnavailable =
            this.previousEntry === undefined;
        }

        this.uiData = new UiData([TraceType.SURFACE_FLINGER]);
        this.uiData.rectsUserOptions = this.rectsUserOptions;
        this.uiData.hierarchyUserOptions = this.hierarchyUserOptions;
        this.uiData.propertiesUserOptions = this.propertiesUserOptions;

        if (this.currentHierarchyTree) {
          this.uiData.highlightedItem = this.highlightedItem;
          this.uiData.highlightedProperty = this.highlightedProperty;

          this.allCurrentRects = UI_RECT_FACTORY.makeUiRects(
            this.currentHierarchyTree,
            this.viewCapturePackageNames,
          );
          this.updateRectUiData();
          this.uiData.displays = this.getDisplays(this.uiData.rectsToDraw);

          this.pinnedItems = [];
          this.uiData.tree = await this.formatHierarchyTreeAndUpdatePinnedItems(
            this.currentHierarchyTree,
          );

          if (this.highlightedItem && this.uiData.tree) {
            const selectedItem = this.currentHierarchyTree.findDfs(
              UiTreeUtils.makeIdMatchFilter(this.highlightedItem),
            );
            if (selectedItem) {
              this.selectedHierarchyTree = selectedItem;
              const propertiesTree =
                await this.selectedHierarchyTree.getAllProperties();
              if (this.selectedHierarchyTree.isRoot()) {
                this.uiData.curatedProperties = undefined;
                this.uiData.displayPropertyGroups = false;
              } else {
                this.uiData.curatedProperties =
                  this.getCuratedProperties(propertiesTree);
                this.uiData.displayPropertyGroups = true;
              }

              this.uiData.propertiesTree = await this.formatPropertiesTree(
                propertiesTree,
                this.selectedHierarchyTree.isRoot(),
              );
            }
          }
        }
        this.copyUiDataAndNotifyView();
      },
    );
  }

  onPinnedItemChange(pinnedItem: UiHierarchyTreeNode) {
    const pinnedId = pinnedItem.id;
    if (this.pinnedItems.map((item) => item.id).includes(pinnedId)) {
      this.pinnedItems = this.pinnedItems.filter(
        (pinned) => pinned.id !== pinnedId,
      );
    } else {
      this.pinnedItems.push(pinnedItem);
    }
    this.updatePinnedIds(pinnedId);
    this.uiData.pinnedItems = this.pinnedItems;
    this.copyUiDataAndNotifyView();
  }

  async onHighlightedNodeChange(item: UiHierarchyTreeNode) {
    this.updateHighlightedItem(item.id);
    this.selectedHierarchyTree = item;
    await this.updateSelectedHierarchyTree(item);
  }

  async onHighlightedIdChange(newId: string) {
    this.updateHighlightedItem(newId);
    this.selectedHierarchyTree = this.currentHierarchyTree?.findDfs(
      UiTreeUtils.makeIdMatchFilter(newId),
    );
    await this.updateSelectedTreeUiData();
  }

  onHighlightedPropertyChange(id: string) {
    if (this.highlightedProperty === id) {
      this.highlightedProperty = '';
    } else {
      this.highlightedProperty = id;
    }
    this.uiData.highlightedProperty = this.highlightedProperty;
    this.copyUiDataAndNotifyView();
  }

  onRectsUserOptionsChange(userOptions: UserOptions) {
    this.rectsUserOptions = userOptions;
    this.uiData.rectsUserOptions = this.rectsUserOptions;
    this.updateRectUiData();
    this.copyUiDataAndNotifyView();
  }

  async onHierarchyUserOptionsChange(userOptions: UserOptions) {
    this.hierarchyUserOptions = userOptions;
    this.uiData.hierarchyUserOptions = this.hierarchyUserOptions;
    this.uiData.tree = await this.formatHierarchyTreeAndUpdatePinnedItems(
      this.currentHierarchyTree,
    );
    this.copyUiDataAndNotifyView();
  }

  async onHierarchyFilterChange(filterString: string) {
    this.hierarchyFilter = UiTreeUtils.makeIdFilter(filterString);
    this.uiData.tree = await this.formatHierarchyTreeAndUpdatePinnedItems(
      this.currentHierarchyTree,
    );
    this.copyUiDataAndNotifyView();
  }

  async onPropertiesUserOptionsChange(userOptions: UserOptions) {
    this.propertiesUserOptions = userOptions;
    this.uiData.propertiesUserOptions = this.propertiesUserOptions;
    await this.updateSelectedTreeUiData();
  }

  async onPropertiesFilterChange(filterString: string) {
    this.propertiesFilter = UiTreeUtils.makePropertyFilter(filterString);
    await this.updateSelectedTreeUiData();
  }

  async onRectDoubleClick(rectId: string) {
    const rectHasViewCapture = this.viewCapturePackageNames.some(
      (packageName) => rectId.includes(packageName),
    );
    if (!rectHasViewCapture) {
      return;
    }
    const newActiveTrace = this.traces.getTrace(TraceType.VIEW_CAPTURE);
    if (!newActiveTrace) {
      return;
    }
    await this.emitWinscopeEvent(new TabbedViewSwitchRequest(newActiveTrace));
  }

  async onRectShowStateChange(id: string, newShowState: RectShowState) {
    this.rectFilter.updateRectShowState(id, newShowState);
    this.updateRectUiData();
    this.copyUiDataAndNotifyView();
  }

  private updateRectUiData() {
    this.uiData.rectsToDraw = this.filterRects(this.allCurrentRects);
    this.uiData.rectIdToShowState = this.rectFilter.getRectIdToShowState(
      this.allCurrentRects,
      this.uiData.rectsToDraw,
    );
  }

  private updateHighlightedItem(id: string) {
    if (this.highlightedItem === id) {
      this.highlightedItem = '';
    } else {
      this.highlightedItem = id;
    }
    this.uiData.highlightedItem = this.highlightedItem;
  }

  private async updateSelectedHierarchyTree(selectedTree: UiHierarchyTreeNode) {
    if (UiTreeUtils.shouldGetProperties(selectedTree)) {
      this.selectedHierarchyTree = selectedTree;
    } else if (selectedTree.getDiff() === DiffType.DELETED_MOVE) {
      const addedMovedNode = this.currentHierarchyTree?.findDfs(
        UiTreeUtils.makeIdMatchFilter(selectedTree.id),
      );
      this.selectedHierarchyTree = addedMovedNode;
    }
    await this.updateSelectedTreeUiData();
  }

  private async initializeIfNeeded() {
    const tracesVc = this.traces.getTraces(TraceType.VIEW_CAPTURE);
    const promisesPackageName = tracesVc.map(async (trace) => {
      const packageAndWindow = await trace.customQuery(
        CustomQueryType.VIEW_CAPTURE_METADATA,
      );
      return packageAndWindow.packageName;
    });
    this.viewCapturePackageNames = await Promise.all(promisesPackageName);
  }

  private getDisplays(rects: UiRect[]): DisplayIdentifier[] {
    const ids: DisplayIdentifier[] = [];

    rects.forEach((rect: UiRect) => {
      if (!rect.isDisplay) return;
      const displayId = rect.id.slice(10, rect.id.length);
      ids.push({displayId, groupId: rect.groupId, name: rect.label});
    });

    let offscreenDisplayCount = 0;
    rects.forEach((rect: UiRect) => {
      if (rect.isDisplay) return;

      if (!ids.find((identifier) => identifier.groupId === rect.groupId)) {
        offscreenDisplayCount++;
        const name =
          'Offscreen Display' +
          (offscreenDisplayCount > 1 ? ` ${offscreenDisplayCount}` : '');
        ids.push({displayId: -1, groupId: rect.groupId, name});
      }
    });

    return ids.sort((a, b) => {
      if (a.name < b.name) {
        return -1;
      }
      if (a.name > b.name) {
        return 1;
      }
      return 0;
    });
  }

  private async updateSelectedTreeUiData() {
    if (this.selectedHierarchyTree) {
      const propertiesTree =
        await this.selectedHierarchyTree.getAllProperties();
      if (this.selectedHierarchyTree.isRoot()) {
        this.uiData.curatedProperties = undefined;
        this.uiData.displayPropertyGroups = false;
      } else {
        this.uiData.curatedProperties =
          this.getCuratedProperties(propertiesTree);
        this.uiData.displayPropertyGroups = true;
      }

      this.uiData.propertiesTree = await this.formatPropertiesTree(
        propertiesTree,
        this.selectedHierarchyTree.isRoot(),
      );
    }
    this.copyUiDataAndNotifyView();
  }

  private getCuratedProperties(tree: PropertyTreeNode): SfCuratedProperties {
    const inputWindowInfo = tree.getChildByName('inputWindowInfo');
    const hasInputChannel =
      inputWindowInfo !== undefined &&
      inputWindowInfo.getAllChildren().length > 0;

    const cropLayerId = hasInputChannel
      ? assertDefined(
          inputWindowInfo.getChildByName('cropLayerId'),
        ).formattedValue()
      : '-1';

    const verboseFlags = tree.getChildByName('verboseFlags')?.formattedValue();
    const flags = assertDefined(tree.getChildByName('flags'));
    const curatedFlags =
      verboseFlags !== '' && verboseFlags !== undefined
        ? verboseFlags
        : flags.formattedValue();

    const bufferTransform = tree.getChildByName('bufferTransform');
    const bufferTransformTypeFlags =
      bufferTransform?.getChildByName('type')?.formattedValue() ?? 'null';

    const curated: SfCuratedProperties = {
      summary: this.getSummaryOfVisibility(tree),
      flags: curatedFlags,
      calcTransform: tree.getChildByName('transform'),
      calcCrop: assertDefined(tree.getChildByName('bounds')).formattedValue(),
      finalBounds: assertDefined(
        tree.getChildByName('screenBounds'),
      ).formattedValue(),
      reqTransform: tree.getChildByName('requestedTransform'),
      reqCrop: this.getCropPropertyValue(tree, 'bounds'),
      bufferSize: assertDefined(
        tree.getChildByName('activeBuffer'),
      ).formattedValue(),
      frameNumber: assertDefined(
        tree.getChildByName('currFrame'),
      ).formattedValue(),
      bufferTransformType: bufferTransformTypeFlags,
      destinationFrame: assertDefined(
        tree.getChildByName('destinationFrame'),
      ).formattedValue(),
      z: assertDefined(tree.getChildByName('z')).formattedValue(),
      relativeParent: assertDefined(
        tree.getChildByName('zOrderRelativeOf'),
      ).formattedValue(),
      calcColor: this.getColorPropertyValue(tree, 'color'),
      calcShadowRadius: this.getPixelPropertyValue(tree, 'shadowRadius'),
      calcCornerRadius: this.getPixelPropertyValue(tree, 'cornerRadius'),
      calcCornerRadiusCrop: this.getCropPropertyValue(tree, 'cornerRadiusCrop'),
      backgroundBlurRadius: this.getPixelPropertyValue(
        tree,
        'backgroundBlurRadius',
      ),
      reqColor: this.getColorPropertyValue(tree, 'requestedColor'),
      reqCornerRadius: this.getPixelPropertyValue(
        tree,
        'requestedCornerRadius',
      ),
      inputTransform: hasInputChannel
        ? inputWindowInfo.getChildByName('transform')
        : undefined,
      inputRegion: tree.getChildByName('inputRegion')?.formattedValue(),
      focusable: hasInputChannel
        ? assertDefined(
            inputWindowInfo.getChildByName('focusable'),
          ).formattedValue()
        : 'null',
      cropTouchRegionWithItem: cropLayerId,
      replaceTouchRegionWithCrop: hasInputChannel
        ? inputWindowInfo
            .getChildByName('replaceTouchableRegionWithCrop')
            ?.formattedValue() ?? 'false'
        : 'false',
      inputConfig:
        inputWindowInfo?.getChildByName('inputConfig')?.formattedValue() ??
        'null',
      ignoreDestinationFrame:
        (flags.getValue() & LayerFlag.IGNORE_DESTINATION_FRAME) ===
        LayerFlag.IGNORE_DESTINATION_FRAME,
      hasInputChannel,
    };
    return curated;
  }

  private getSummaryOfVisibility(tree: PropertyTreeNode): SfSummaryProperty[] {
    const summary: SfSummaryProperty[] = [];
    const visibilityReason = tree.getChildByName('visibilityReason');
    if (visibilityReason && visibilityReason.getAllChildren().length > 0) {
      const reason = this.mapNodeArrayToString(
        visibilityReason.getAllChildren(),
      );
      summary.push({key: 'Invisible due to', simpleValue: reason});
    }

    const occludedBy = tree.getChildByName('occludedBy')?.getAllChildren();
    if (occludedBy && occludedBy.length > 0) {
      summary.push({
        key: 'Occluded by',
        layerValues: occludedBy.map((layer) => this.getLayerSummary(layer)),
      });
    }

    const partiallyOccludedBy = tree
      .getChildByName('partiallyOccludedBy')
      ?.getAllChildren();
    if (partiallyOccludedBy && partiallyOccludedBy.length > 0) {
      summary.push({
        key: 'Partially occluded by',
        layerValues: partiallyOccludedBy.map((layer) =>
          this.getLayerSummary(layer),
        ),
      });
    }

    const coveredBy = tree.getChildByName('coveredBy')?.getAllChildren();
    if (coveredBy && coveredBy.length > 0) {
      summary.push({
        key: 'Covered by',
        layerValues: coveredBy.map((layer) => this.getLayerSummary(layer)),
      });
    }
    return summary;
  }

  private mapNodeArrayToString(nodes: readonly PropertyTreeNode[]): string {
    return nodes.map((reason) => reason.formattedValue()).join(', ');
  }

  private getLayerSummary(layer: PropertyTreeNode): SfLayerSummary {
    const nodeId = layer.formattedValue();
    const [layerId, name] = nodeId.split(' ');
    return {
      layerId,
      nodeId,
      name,
    };
  }

  private getPixelPropertyValue(tree: PropertyTreeNode, label: string): string {
    const propVal = assertDefined(tree.getChildByName(label)).formattedValue();
    return propVal !== 'null' ? `${propVal} px` : '0 px';
  }

  private getCropPropertyValue(tree: PropertyTreeNode, label: string): string {
    const propVal = assertDefined(tree.getChildByName(label)).formattedValue();
    return propVal !== 'null' ? propVal : EMPTY_OBJ_STRING;
  }

  private getColorPropertyValue(tree: PropertyTreeNode, label: string): string {
    const propVal = assertDefined(tree.getChildByName(label)).formattedValue();
    return propVal !== 'null' ? propVal : 'no color found';
  }

  private filterRects(rects: UiRect[]): UiRect[] {
    const isOnlyVisibleMode =
      this.rectsUserOptions['showOnlyVisible']?.enabled ?? false;
    const isIgnoreNonHiddenMode =
      this.rectsUserOptions['ignoreNonHidden']?.enabled ?? false;
    return this.rectFilter.filterRects(
      rects,
      isOnlyVisibleMode,
      isIgnoreNonHiddenMode,
    );
  }

  private async formatHierarchyTreeAndUpdatePinnedItems(
    hierarchyTree: HierarchyTreeNode | undefined,
  ): Promise<UiHierarchyTreeNode | undefined> {
    if (!hierarchyTree) return undefined;

    const uiTree = UiHierarchyTreeNode.from(hierarchyTree);

    if (this.currentHierarchyTreeName) {
      uiTree.setDisplayName(this.currentHierarchyTreeName);
    }

    const formatter = new UiTreeFormatter<UiHierarchyTreeNode>().setUiTree(
      uiTree,
    );

    if (
      this.hierarchyUserOptions['showDiff']?.enabled &&
      !this.hierarchyUserOptions['showDiff']?.isUnavailable
    ) {
      if (this.previousEntry && !this.previousHierarchyTree) {
        this.previousHierarchyTree = await this.previousEntry.getValue();
      }
      const prevEntryUiTree = this.previousHierarchyTree
        ? UiHierarchyTreeNode.from(this.previousHierarchyTree)
        : undefined;
      await new AddDiffsHierarchyTree(
        this.isHierarchyTreeModified,
      ).executeInPlace(uiTree, prevEntryUiTree);
    }

    if (this.hierarchyUserOptions['flat']?.enabled) {
      formatter.addOperation(new FlattenChildren());
    }

    const predicates = [this.hierarchyFilter];
    if (this.hierarchyUserOptions['showOnlyVisible']?.enabled) {
      predicates.push(UiTreeUtils.isVisible);
    }

    formatter
      .addOperation(new Filter(predicates, true))
      .addOperation(new AddChips());

    if (this.hierarchyUserOptions['simplifyNames']?.enabled) {
      formatter.addOperation(new SimplifyNames());
    }

    const formattedTree = formatter.format();
    this.pinnedItems.push(...this.getPinnedItems(formattedTree));
    this.uiData.pinnedItems = this.pinnedItems;
    return formattedTree;
  }

  private getPinnedItems(tree: UiHierarchyTreeNode): UiHierarchyTreeNode[] {
    const pinnedNodes = [];

    if (this.pinnedIds.includes(tree.id)) {
      pinnedNodes.push(tree);
    }

    for (const child of tree.getAllChildren()) {
      pinnedNodes.push(...this.getPinnedItems(child));
    }

    return pinnedNodes;
  }

  private async formatPropertiesTree(
    propertiesTree: PropertyTreeNode,
    isHierarchyTreeRoot: boolean,
  ): Promise<UiPropertyTreeNode> {
    const uiTree = UiPropertyTreeNode.from(propertiesTree);

    if (
      this.propertiesUserOptions['showDiff']?.enabled &&
      !this.propertiesUserOptions['showDiff']?.isUnavailable
    ) {
      if (this.previousEntry && !this.previousHierarchyTree) {
        this.previousHierarchyTree = await this.previousEntry.getValue();
      }
      const prevEntryNode = this.previousHierarchyTree?.findDfs(
        UiTreeUtils.makeIdMatchFilter(propertiesTree.id),
      );
      const prevEntryUiTree = prevEntryNode
        ? UiPropertyTreeNode.from(await prevEntryNode.getAllProperties())
        : undefined;
      await new AddDiffsPropertiesTree(
        this.isPropertyNodeModified,
      ).executeInPlace(uiTree, prevEntryUiTree);
    }

    if (isHierarchyTreeRoot && this.currentHierarchyTreeName) {
      uiTree.setDisplayName(this.currentHierarchyTreeName);
    }

    const predicatesKeepingChildren = [this.propertiesFilter];
    const predicatesDiscardingChildren = [
      UiTreeUtils.makeDenyListFilterByName(Presenter.DENYLIST_PROPERTY_NAMES),
    ];

    if (!this.propertiesUserOptions['showDefaults']?.enabled) {
      predicatesDiscardingChildren.push(UiTreeUtils.isNotDefault);
      predicatesDiscardingChildren.push(
        UiTreeUtils.makePropertyMatchFilter('IDENTITY'),
      );
    }

    if (!isHierarchyTreeRoot) {
      predicatesDiscardingChildren.push(UiTreeUtils.isNotCalculated);
    }

    return new UiTreeFormatter<UiPropertyTreeNode>()
      .setUiTree(uiTree)
      .addOperation(new Filter(predicatesDiscardingChildren, false))
      .addOperation(new Filter(predicatesKeepingChildren, true))
      .format();
  }

  private updatePinnedIds(newId: string) {
    if (this.pinnedIds.includes(newId)) {
      this.pinnedIds = this.pinnedIds.filter((pinned) => pinned !== newId);
    } else {
      this.pinnedIds.push(newId);
    }
  }

  private copyUiDataAndNotifyView() {
    // Create a shallow copy of the data, otherwise the Angular OnPush change detection strategy
    // won't detect the new input
    const copy = Object.assign({}, this.uiData);
    this.notifyViewCallback(copy);
  }

  private isHierarchyTreeModified: IsModifiedCallbackType = async (
    newTree: TreeNode | undefined,
    oldTree: TreeNode | undefined,
  ) => {
    if (!newTree && !oldTree) return false;
    if (!newTree || !oldTree) return true;
    if ((newTree as UiHierarchyTreeNode).isRoot()) return false;
    const newProperties = await (
      newTree as UiHierarchyTreeNode
    ).getAllProperties();
    const oldProperties = await (
      oldTree as UiHierarchyTreeNode
    ).getAllProperties();

    return await this.isChildPropertyModified(newProperties, oldProperties);
  };

  private async isChildPropertyModified(
    newProperties: PropertyTreeNode,
    oldProperties: PropertyTreeNode,
  ): Promise<boolean> {
    for (const newProperty of newProperties.getAllChildren()) {
      if (Presenter.DENYLIST_PROPERTY_NAMES.includes(newProperty.name)) {
        continue;
      }
      if (newProperty.source === PropertySource.CALCULATED) {
        continue;
      }

      const oldProperty = oldProperties.getChildByName(newProperty.name);
      if (!oldProperty) {
        return true;
      }

      if (newProperty.getAllChildren().length === 0) {
        if (await this.isPropertyNodeModified(newProperty, oldProperty)) {
          return true;
        }
      } else {
        const childrenModified = await this.isChildPropertyModified(
          newProperty,
          oldProperty,
        );
        if (childrenModified) return true;
      }
    }
    return false;
  }

  private isPropertyNodeModified: IsModifiedCallbackType = async (
    newTree: TreeNode | undefined,
    oldTree: TreeNode | undefined,
  ) => {
    if (!newTree && !oldTree) return false;
    if (!newTree || !oldTree) return true;

    const newValue = (newTree as UiPropertyTreeNode).formattedValue();
    const oldValue = (oldTree as UiPropertyTreeNode).formattedValue();
    return oldValue !== newValue;
  };

  static readonly DENYLIST_PROPERTY_NAMES = [
    'name',
    'children',
    'dpiX',
    'dpiY',
  ];
}
