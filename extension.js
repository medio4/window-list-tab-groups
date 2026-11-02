// SPDX-FileCopyrightText: 2026 Jacob Corbley
//
// SPDX-License-Identifier: GPL-2.0-or-later

// Adds Chrome-style tab groups to the stock GNOME Shell Window List
// extension. The window list's classes aren't exported, so they are reached
// through its live instances and patched with an InjectionManager.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {
    Extension,
    InjectionManager,
    gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {DashItemContainer} from 'resource:///org/gnome/shell/ui/dash.js';

const WINDOW_LIST_UUID = 'window-list@gnome-shell-extensions.gcampax.github.com';

const TAB_GROUPS_KEY = 'window-list-tab-groups';

const MIN_DRAG_UPDATE_INTERVAL = 500 * GLib.TIME_SPAN_MILLISECOND;
const DRAG_OPACITY = 0.3;
const DRAG_FADE_DURATION = 200;

// Chrome's tab group palette (dark variants, readable with dark text)
const TAB_GROUP_COLORS = {
    grey: '#dadce0',
    blue: '#8ab4f8',
    red: '#f28b82',
    yellow: '#fdd663',
    green: '#81c995',
    pink: '#ff8bcb',
    purple: '#c58af9',
    cyan: '#78d9ec',
    orange: '#fcad70',
};

const isWindowButton = actor => actor?.metaWindow !== undefined;
const isListButton = actor => isWindowButton(actor) || actor?.app !== undefined;

class DragPlaceholderItem extends DashItemContainer {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super();
        this.setChild(new St.Bin({style_class: 'placeholder'}));
    }
}

class TabGroupMenu extends PopupMenu.PopupMenu {
    constructor(source, group, controller) {
        super(source, 0.5, St.Side.BOTTOM);

        this._group = group;
        this._controller = controller;

        const nameItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._entry = new St.Entry({
            style_class: 'tab-group-name-entry',
            hint_text: _('Name this group'),
            can_focus: true,
            x_expand: true,
        });
        this._entry.clutter_text.connect('text-changed',
            () => this._controller.renameGroup(this._group, this._entry.text));
        this._entry.clutter_text.connect('activate', () => this.close());
        nameItem.add_child(this._entry);
        this.addMenuItem(nameItem);

        const colorItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const colorBox = new St.BoxLayout({style_class: 'tab-group-color-box'});
        this._swatches = new Map();
        for (const [name, color] of Object.entries(TAB_GROUP_COLORS)) {
            const swatch = new St.Button({
                style_class: 'tab-group-swatch',
                style: `background-color: ${color};`,
                can_focus: true,
            });
            swatch.connect('clicked',
                () => this._controller.setGroupColor(this._group, name));
            colorBox.add_child(swatch);
            this._swatches.set(name, swatch);
        }
        colorItem.add_child(colorBox);
        this.addMenuItem(colorItem);

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._collapseItem = this.addAction('',
            () => this._controller.toggleGroup(this._group));
        this.addAction(_('Ungroup'),
            () => this._controller.ungroup(this._group));
        this.addAction(_('Close group'),
            () => this._controller.closeGroup(this._group));

        this.connect('open-state-changed', () => {
            if (this.isOpen)
                this.sync();
        });
    }

    sync() {
        if (this._entry.text !== this._group.name)
            this._entry.text = this._group.name;
        this._collapseItem.label.text = this._group.collapsed
            ? _('Expand group') : _('Collapse group');
        for (const [name, swatch] of this._swatches) {
            if (name === this._group.color)
                swatch.add_style_pseudo_class('checked');
            else
                swatch.remove_style_pseudo_class('checked');
        }
    }

    focusName() {
        this._entry.grab_key_focus();
        this._entry.clutter_text.set_selection(0, -1);
    }
}

class TabGroupChip extends St.Button {
    static {
        GObject.registerClass({
            Signals: {
                'drag-begin': {},
                'drag-end': {},
            },
        }, this);
    }

    constructor(group, controller) {
        super({
            style_class: 'tab-group-chip',
            can_focus: true,
            y_align: Clutter.ActorAlign.FILL,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
        });

        this.group = group;

        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this.set_child(this._label);

        this._menu = new TabGroupMenu(this, group, controller);
        this._menu.actor.hide();
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menuManager.addMenu(this._menu);
        Main.uiGroup.add_child(this._menu.actor);

        this.connect('clicked', (_actor, button) => {
            if (button === 3)
                this.openMenu();
            else
                controller.toggleGroup(group);
        });
        this.connect('popup-menu', () => this.openMenu());
        this.connect('destroy', () => this._menu.destroy());

        // Dragging the label moves the whole group
        this._delegate = this;
        this._draggable = DND.makeDraggable(this);
        this._draggable.connectObject(
            'drag-begin', () => this.emit('drag-begin'),
            'drag-cancelled', () => this.emit('drag-end'),
            'drag-end', () => this.emit('drag-end'),
            this);
    }

    getDragActor() {
        const dragActor = new St.Label({
            style_class: 'tab-group-chip',
            style: this.style,
            text: this._label.text,
        });
        dragActor.source = this;
        return dragActor;
    }

    getDragActorSource() {
        return this;
    }

    openMenu(focusName = false) {
        if (!this._menu.isOpen)
            this._menu.open();
        if (focusName)
            this._menu.focusName();
    }

    sync(nWindows, hasFocus) {
        const {name, color, collapsed} = this.group;
        this._label.text = collapsed
            ? [name, `${nWindows}`].filter(s => s).join('  ')
            : name;
        this.style = `background-color: ${TAB_GROUP_COLORS[color]};`;
        this.accessible_name = name || _('Unnamed group');

        if (collapsed)
            this.add_style_pseudo_class('checked');
        else
            this.remove_style_pseudo_class('checked');

        if (hasFocus)
            this.add_style_class_name('focused');
        else
            this.remove_style_class_name('focused');

        if (this._menu.isOpen)
            this._menu.sync();
    }
}

// The tab groups of one window list (there is one list per monitor)
class TabGroupController {
    constructor(windowList) {
        this._list = windowList;
        this._box = windowList._windowList;
        this._signals = {};

        global.display.connectObject('notify::focus-window',
            () => this._onFocusWindowChanged(), this._signals);
        global.window_manager.connectObject('switch-workspace',
            () => this.syncChips(), this._signals);
        windowList.connectObject('destroy', () => {
            this.destroy(false);
            delete windowList._tabGroups;
        }, this._signals);

        this._load();
    }

    get _stateKey() {
        return `${TAB_GROUPS_KEY}:${this._list._monitor.index}`;
    }

    _load() {
        this._groups = new Map();
        this._nextId = 1;

        let saved = [];
        try {
            const state = global.get_runtime_state('s', this._stateKey);
            saved = JSON.parse(state?.deepUnpack() ?? '[]');
        } catch (e) {
            console.warn(`Ignoring saved tab groups: ${e.message}`);
        }

        for (const {id, name, color, collapsed, windows} of saved) {
            this._groups.set(id, {
                id,
                name,
                color: color in TAB_GROUP_COLORS ? color : 'grey',
                collapsed,
                windows: new Set(windows),
                chip: null,
            });
            this._nextId = Math.max(this._nextId, id + 1);
        }
    }

    _save() {
        const groups = [...this._groups.values()].map(g => ({
            id: g.id,
            name: g.name,
            color: g.color,
            collapsed: g.collapsed,
            windows: [...g.windows],
        }));
        global.set_runtime_state(this._stateKey,
            new GLib.Variant('s', JSON.stringify(groups)));
    }

    _windowButtons() {
        return this._box.get_children().filter(isWindowButton);
    }

    _findGroup(metaWindow) {
        const id = metaWindow.get_id();
        for (const group of this._groups.values()) {
            if (group.windows.has(id))
                return group;
        }
        return null;
    }

    _deleteGroup(group) {
        this._groups.delete(group.id);
        group.chip?.destroy();
        group.chip = null;
    }

    groupActors(group) {
        return [group.chip, ...this._windowButtons()
            .filter(b => b._tabGroup === group)].filter(a => a);
    }

    // Keep each group's chip directly in front of its windows, and the
    // windows of a group next to each other (where the first one sits)
    layout() {
        if (this._list._grouped) {
            this._groups.forEach(g => g.chip?.destroy());
            return;
        }

        const buttons = this._windowButtons();
        buttons.forEach(b => this._addMenuItems(b));

        const present = new Set(buttons.map(b => b.metaWindow.get_id()));
        for (const group of [...this._groups.values()]) {
            group.windows.forEach(id => !present.has(id) && group.windows.delete(id));
            if (group.windows.size === 0)
                this._deleteGroup(group);
        }

        const order = [];
        const placed = new Set();
        for (const button of buttons) {
            const group = this._findGroup(button.metaWindow);
            this._setButtonGroup(button, group);

            if (!group) {
                order.push(button);
                continue;
            }
            if (placed.has(group))
                continue;
            placed.add(group);

            if (!group.chip)
                this._box.add_child(this._createChip(group));
            order.push(group.chip, ...buttons.filter(
                b => this._findGroup(b.metaWindow) === group));
        }

        order.forEach((actor, i) => {
            if (this._box.get_child_at_index(i) !== actor)
                this._box.set_child_at_index(actor, i);
        });

        this.syncChips();
        this._save();
    }

    _createChip(group) {
        const chip = new TabGroupChip(group, this);
        chip.connect('destroy', () => {
            if (group.chip === chip)
                group.chip = null;
        });
        chip.connect('drag-begin', () => {
            this.groupActors(group).forEach(a => a.ease({
                opacity: 255 * DRAG_OPACITY,
                duration: DRAG_FADE_DURATION,
            }));
            this._list._monitorItemDrag();
        });
        chip.connect('drag-end', () => {
            this.groupActors(group).forEach(a => a.ease({
                opacity: 255,
                duration: DRAG_FADE_DURATION,
            }));
            this._list._stopMonitoringItemDrag();
            this._list._clearDragPlaceholder();
        });
        group.chip = chip;
        return chip;
    }

    _setButtonGroup(button, group) {
        button._tabGroup = group;
        // Underline the button in the group's color, drawn like the stock
        // attention indicator so it shows whatever the button's state
        if (group) {
            if (!button._tabGroupLine) {
                button._tabGroupLine = new St.Widget({
                    style_class: 'tab-group-line',
                    x_expand: true,
                    y_expand: true,
                    y_align: Clutter.ActorAlign.END,
                });
                const title = button._windowTitle;
                title.insert_child_below(button._tabGroupLine,
                    title._attentionIndicator ?? null);
            }
            button._tabGroupLine.style =
                `background-color: ${TAB_GROUP_COLORS[group.color]};`;
        } else {
            button._tabGroupLine?.destroy();
            delete button._tabGroupLine;
        }
        button._updateVisibility();
    }

    syncChips() {
        const buttons = this._windowButtons();
        const {focusWindow} = global.display;

        for (const group of this._groups.values()) {
            if (!group.chip)
                continue;
            const members = buttons.filter(b => b._tabGroup === group);
            group.chip.visible = members.some(b => b._isWindowVisible(b.metaWindow));
            group.chip.sync(members.length,
                members.some(b => b.metaWindow === focusWindow));
        }
    }

    _onFocusWindowChanged() {
        const {focusWindow} = global.display;
        const switched = focusWindow && focusWindow !== this._lastFocusWindow;
        if (focusWindow)
            this._lastFocusWindow = focusWindow;
        const group = focusWindow ? this._findGroup(focusWindow) : null;

        // Like Chrome, switching to a window of a collapsed group opens it up
        if (switched && group?.collapsed && !this._list._grouped)
            this.toggleGroup(group);
        else
            this.syncChips();
    }

    _addMenuItems(button) {
        if (button._tabGroupSection)
            return;

        const menu = button._contextMenu;
        const section = new PopupMenu.PopupMenuSection();
        const separator = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(section, 0);
        menu.addMenuItem(separator, 1);
        button._tabGroupSection = section;
        button._tabGroupSeparator = separator;

        menu.connectObject('open-state-changed', () => {
            if (!menu.isOpen)
                return;

            section.removeAll();
            const current = button._tabGroup;

            section.addAction(_('Add to new group'),
                () => this._createGroup(button));

            for (const group of this._groups.values()) {
                if (group === current)
                    continue;
                const label = current ? _('Move to “%s”') : _('Add to “%s”');
                const item = section.addAction(
                    label.format(group.name || _('Unnamed group')),
                    () => this.moveToGroup(button, group));
                item.insert_child_at_index(new St.Widget({
                    style_class: 'tab-group-menu-dot',
                    style: `background-color: ${TAB_GROUP_COLORS[group.color]};`,
                    y_align: Clutter.ActorAlign.CENTER,
                }), 1);
            }

            if (current) {
                section.addAction(_('Remove from group'),
                    () => this.removeFromGroup(button));
            }
        }, section);
    }

    _createGroup(button) {
        const used = new Set([...this._groups.values()].map(g => g.color));
        const colors = Object.keys(TAB_GROUP_COLORS);
        const color = colors.find(c => c !== 'grey' && !used.has(c)) ??
            colors[this._nextId % colors.length];

        const group = {
            id: this._nextId++,
            name: '',
            color,
            collapsed: false,
            windows: new Set(),
            chip: null,
        };
        this._groups.set(group.id, group);
        this.moveToGroup(button, group);

        // Let the window menu finish closing before asking for a name
        GLib.idle_add_once(GLib.PRIORITY_DEFAULT,
            () => group.chip?.openMenu(true));
    }

    moveToGroup(button, group) {
        // Join at the end of the group, like Chrome
        const members = this._windowButtons().filter(b => b._tabGroup === group);
        const last = members[members.length - 1];
        if (last && last !== button)
            this._box.set_child_above_sibling(button, last);

        button._tabGroup?.windows.delete(button.metaWindow.get_id());
        group.windows.add(button.metaWindow.get_id());
        this.layout();
    }

    removeFromGroup(button) {
        const group = button._tabGroup;
        if (!group)
            return;
        group.windows.delete(button.metaWindow.get_id());

        // Leave the group by stepping out behind its last window
        const members = this._windowButtons().filter(b => b._tabGroup === group);
        const last = members[members.length - 1];
        if (last && last !== button)
            this._box.set_child_above_sibling(button, last);

        this.layout();
    }

    isInsideGroup(prev, next) {
        if (prev instanceof TabGroupChip)
            return !prev.group.collapsed;
        return isWindowButton(prev) && isWindowButton(next) &&
            !!prev._tabGroup && prev._tabGroup === next._tabGroup;
    }

    joinFromNeighbors(button) {
        const items = this._box.get_children().filter(c =>
            c !== this._list._dragPlaceholder && (c === button || c.visible));
        const i = items.indexOf(button);
        const prev = items[i - 1];
        const next = items[i + 1];
        const groupOf = a => (isWindowButton(a) ? a._tabGroup ?? null : null);
        const current = button._tabGroup ?? null;

        // Landing right after an open group's label or windows joins it
        let target = null;
        if (prev instanceof TabGroupChip)
            target = prev.group.collapsed ? null : prev.group;
        else if (groupOf(prev))
            target = groupOf(prev);
        else if (current && groupOf(next) === current)
            target = current;

        if (target === current)
            return;

        current?.windows.delete(button.metaWindow.get_id());
        target?.windows.add(button.metaWindow.get_id());
    }

    toggleGroup(group) {
        group.collapsed = !group.collapsed;
        this.layout();
    }

    renameGroup(group, name) {
        if (group.name === name)
            return;
        group.name = name;
        this.syncChips();
        this._save();
    }

    setGroupColor(group, color) {
        group.color = color;
        this.layout();
    }

    ungroup(group) {
        this._deleteGroup(group);
        this.layout();
    }

    closeGroup(group) {
        this._windowButtons()
            .filter(b => b._tabGroup === group)
            .forEach(b => b.metaWindow.delete(global.get_current_time()));
    }

    // Undo our changes; restoreButtons is false when the list itself is
    // being destroyed and its buttons go with it
    destroy(restoreButtons = true) {
        global.display.disconnectObject(this._signals);
        global.window_manager.disconnectObject(this._signals);
        this._list.disconnectObject(this._signals);

        if (!restoreButtons)
            return;

        for (const group of this._groups.values())
            group.chip?.destroy();

        for (const button of this._windowButtons()) {
            button._tabGroupSection?.destroy();
            button._tabGroupSeparator?.destroy();
            delete button._tabGroupSection;
            delete button._tabGroupSeparator;
            delete button._tabGroup;
            button._tabGroupLine?.destroy();
            delete button._tabGroupLine;
            button._updateVisibility();
        }
    }
}

function getController(windowList) {
    windowList._tabGroups ??= new TabGroupController(windowList);
    return windowList._tabGroups;
}

function isOverActor(actor, x) {
    const [actorX] = actor.get_transformed_position();
    return x >= actorX && x < actorX + actor.width;
}

// Replaces WindowList.handleDragOver: counts group chips, skips collapsed
// windows, and lets a chip carry its whole group
function handleDragOver(source, _actor, x, _y, _time) {
    const isChip = source instanceof TabGroupChip;
    if (!isListButton(source) && !isChip)
        return DND.DragMotionResult.NO_DROP;

    const controller = getController(this);
    const items = this._windowList.get_children().filter(c =>
        (isListButton(c) || c instanceof TabGroupChip) && c.visible);

    // Hovering a window over a group's label or windows offers to add it
    // to that group
    const hovered = isWindowButton(source)
        ? items.find(c => c !== source && isOverActor(c, x))
        : null;
    const hoveredGroup = hovered instanceof TabGroupChip
        ? hovered.group : hovered?._tabGroup ?? null;
    const chip = hoveredGroup?.chip;
    if (chip && hoveredGroup !== source._tabGroup) {
        if (this._tabGroupDropChip !== chip) {
            this._clearDragPlaceholder();
            this._tabGroupDropChip = chip;
            chip.add_style_pseudo_class('drop');
            // Any non-negative position lets the drop through
            this._dragPlaceholderPos = Number.MAX_SAFE_INTEGER;
        }
        return DND.DragMotionResult.MOVE_DROP;
    }
    if (this._tabGroupDropChip)
        this._clearDragPlaceholder();

    const sourcePos = items.indexOf(source);
    const span = isChip
        ? 1 + items.filter(c => c._tabGroup === source.group).length
        : 1;
    const numItems = items.length;
    const boxWidth = this._windowList.width;

    // Transform to window list coordinates for index calculation
    x -= this._windowList.x;

    const rtl = this.text_direction === Clutter.TextDirection.RTL;
    let pos = rtl
        ? numItems - Math.round(x * numItems / boxWidth)
        : Math.round(x * numItems / boxWidth);

    pos = Math.clamp(pos, 0, numItems);

    const timeDelta = GLib.get_monotonic_time() - this._lastPlaceholderUpdate;

    if (pos !== this._dragPlaceholderPos && timeDelta >= MIN_DRAG_UPDATE_INTERVAL) {
        this._clearDragPlaceholder();
        this._dragPlaceholderPos = pos;

        this._lastPlaceholderUpdate = GLib.get_monotonic_time();

        // Don't allow positioning next to self, or a group inside another
        if (pos >= sourcePos && pos <= sourcePos + span)
            return DND.DragMotionResult.CONTINUE;
        if (isChip && controller.isInsideGroup(items[pos - 1], items[pos]))
            return DND.DragMotionResult.CONTINUE;

        this._dragPlaceholder = new DragPlaceholderItem();
        const sibling = items[pos] ?? null;
        if (sibling)
            this._windowList.insert_child_below(this._dragPlaceholder, sibling);
        else
            this._windowList.insert_child_above(this._dragPlaceholder, null);
        this._dragPlaceholder.show(true);
    }

    return this._dragPlaceholder
        ? DND.DragMotionResult.MOVE_DROP
        : DND.DragMotionResult.NO_DROP;
}

// Replaces WindowList.acceptDrop
function acceptDrop(source, _actor, _x, _y, _time) {
    const controller = getController(this);

    if (this._tabGroupDropChip) {
        controller.moveToGroup(source, this._tabGroupDropChip.group);
    } else if (this._dragPlaceholder) {
        if (source instanceof TabGroupChip) {
            controller.groupActors(source.group).forEach(a =>
                this._windowList.set_child_below_sibling(a, this._dragPlaceholder));
        } else {
            const pos = this._windowList.get_children()
                .indexOf(this._dragPlaceholder);
            this._windowList.set_child_at_index(source, pos);

            if (isWindowButton(source))
                controller.joinFromNeighbors(source);
        }
    }

    this._clearDragPlaceholder();

    controller.layout();
    this._savePositions();

    return true;
}

export default class WindowListTabGroupsExtension extends Extension {
    enable() {
        this._injections = new InjectionManager();
        this._listPatched = false;
        this._buttonPatched = false;

        // The Window List may be enabled after us or turned off and on, and
        // it builds its lists once monitors are known (and again when they
        // change), so check back after each of those
        Main.extensionManager.connectObject('extension-state-changed',
            (_manager, extension) => {
                if (extension.uuid === WINDOW_LIST_UUID)
                    this._queueAttach();
            }, this);
        Main.layoutManager.connectObject(
            'monitors-changed', () => this._queueAttach(),
            'startup-complete', () => this._queueAttach(),
            this);

        this._attach();
    }

    _queueAttach() {
        if (this._attachId)
            return;
        this._attachId = GLib.idle_add_once(GLib.PRIORITY_DEFAULT, () => {
            delete this._attachId;
            this._attach();
        });
    }

    _getWindowLists() {
        return Main.extensionManager.lookup(WINDOW_LIST_UUID)
            ?.stateObj?._windowLists ?? [];
    }

    _attach() {
        const lists = this._getWindowLists();
        if (lists.length === 0)
            return;

        if (!this._listPatched) {
            this._patchWindowList(Object.getPrototypeOf(lists[0]));
            this._listPatched = true;
        }

        lists.forEach(list => this._layout(list));
    }

    _layout(list) {
        // Window buttons are only reachable once a window is listed
        if (!this._buttonPatched) {
            const button = list._windowList.get_children().find(isWindowButton);
            if (button) {
                this._patchWindowButton(Object.getPrototypeOf(button));
                this._buttonPatched = true;
            }
        }
        getController(list).layout();
    }

    _patchWindowList(proto) {
        const extension = this;

        this._injections.overrideMethod(proto, '_populateWindowList',
            original => function (...args) {
                original.call(this, ...args);
                extension._layout(this);
            });

        this._injections.overrideMethod(proto, '_addWindow',
            original => function (...args) {
                original.call(this, ...args);
                extension._layout(this);
            });

        this._injections.overrideMethod(proto, '_removeWindow',
            original => function (win) {
                const button = this._windowList.get_children()
                    .find(c => c.metaWindow === win);
                if (button?._tabGroup)
                    getController(this).removeFromGroup(button);
                original.call(this, win);
            });

        this._injections.overrideMethod(proto, '_onScrollEvent',
            original => function (actor, event) {
                // Scroll through windows only, not group chips
                const chips = this._windowList.get_children()
                    .filter(c => c instanceof TabGroupChip && c.visible);
                chips.forEach(c => (c.visible = false));
                const result = original.call(this, actor, event);
                chips.forEach(c => (c.visible = true));
                return result;
            });

        this._injections.overrideMethod(proto, '_clearDragPlaceholder',
            original => function () {
                this._tabGroupDropChip?.remove_style_pseudo_class('drop');
                delete this._tabGroupDropChip;
                original.call(this);
            });

        this._injections.overrideMethod(proto, 'handleDragOver',
            () => handleDragOver);
        this._injections.overrideMethod(proto, 'acceptDrop',
            () => acceptDrop);
    }

    _patchWindowButton(proto) {
        this._injections.overrideMethod(proto, '_updateVisibility',
            original => function () {
                original.call(this);
                if (this._tabGroup?.collapsed)
                    this.visible = false;
            });
    }

    disable() {
        Main.extensionManager.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        if (this._attachId)
            GLib.source_remove(this._attachId);
        delete this._attachId;

        this._injections.clear();
        this._injections = null;

        for (const list of this._getWindowLists()) {
            list._tabGroups?.destroy();
            delete list._tabGroups;
        }
    }
}
