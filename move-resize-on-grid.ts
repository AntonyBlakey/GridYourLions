#!/usr/bin/env node

import * as shell from 'shelljs';

const parent_window_re = /Parent window id: (0x[0-9a-f]+)/;
function getParent(id: String): String {
    const window_info = shell.exec(`xwininfo -id ${id} -children`, { silent: true }).stdout;
    return window_info.match(parent_window_re)[1];
}

let _active_window_direct_id = null;
function activeWindowDirectId(): String {
    if (_active_window_direct_id == null) {
        _active_window_direct_id = shell.exec('xprop -root _NET_ACTIVE_WINDOW', { silent: true }).stdout.match(id_re)[0];
    }
    return _active_window_direct_id;
}

let _active_window_id = null;
function activeWindowId(): String {
    if (_active_window_id == null) {
        _active_window_id = getParent(activeWindowDirectId());
        console.log("Active Window:", _active_window_id);
    }
    return _active_window_id;
}

const resize_increment_re = /program specified resize increment: (\d+) by (\d+)/;
const base_size_re = /program specified base size: (\d+) by (\d+)/;
const wininfo_geometry_re = /-geometry (\d+)x(\d+)/;
let _resize_data = null;
function resizeData(): number[] {
    if (_resize_data == null) {
        const wininfo = shell.exec(`xwininfo -id ${activeWindowDirectId()}`, { silent: true }).stdout;
        const g = wininfo.match(wininfo_geometry_re);
        const props = shell.exec(`xprop -id ${activeWindowDirectId()} WM_NORMAL_HINTS`, { silent: true }).stdout;
        const ri = props.match(resize_increment_re);
        const bs = props.match(base_size_re);
        if (ri == null) {
            _resize_data = [
                [Number.parseInt(g[1]), 0, 1],
                [Number.parseInt(g[2]), 0, 1]
            ];
        } else {
            _resize_data = [
                [Number.parseInt(g[1]), Number.parseInt(bs[1]), Number.parseInt(ri[1])],
                [Number.parseInt(g[2]), Number.parseInt(bs[2]), Number.parseInt(ri[2])]
            ];
        }
    }
    return _resize_data;
}

const id_re = /(0x[0-9a-f]+)/g;
let _client_ids = null;
function clientIds(): Set<String> {
    if (_client_ids == null) {
        _client_ids = new Set<String>();
        const clients = shell.exec('xprop -root _NET_CLIENT_LIST', { silent: true }).stdout.match(id_re);
        clients.forEach(id => _client_ids.add(getParent(id)))
    }
    return _client_ids;
}

const geometry_re = /^ +(0x[0-9a-f]+).+ (\d+)x(\d+)\+(-?\d+)\+(-?\d+) /;
let _geometries = null;
function geometries(): Map<String, number[]> {
    if (_geometries == null) {
        _geometries = new Map<String, number[]>();
        const lines = shell.exec(`xwininfo -root -children`, { silent: true }).stdout.split('\n');
        lines.forEach(line => {
            const geometry = line.match(geometry_re);
            if (geometry) {
                const id = geometry[1];
                if (clientIds().has(id)) {
                    const w = Number.parseInt(geometry[2]);
                    const h = Number.parseInt(geometry[3]);
                    const x = Number.parseInt(geometry[4]);
                    const y = Number.parseInt(geometry[5]);
                    _geometries.set(id, [x, y, x + w, y + h]);
                }
            }
        });
        console.log("Geometries:", _geometries);
    }
    return _geometries;
}

const X_AXIS = 0;
const Y_AXIS = 1;

function computeGrid(axis: number): number[] {
    const unique_lines = new Set<number>();
    clientIds().forEach(id => {
        if (id != activeWindowId()) {
            const geometry = geometries().get(id);
            unique_lines.add(geometry[0 + axis]);
            unique_lines.add(geometry[2 + axis]);
        }
    });
    const sorted_lines = Array.from(unique_lines).sort((n1, n2) => n1 - n2);
    return sorted_lines
}

function movePositive(axis: number): number {
    const grid = computeGrid(axis);
    const geometry = geometries().get(activeWindowId());
    const leading = geometry[0 + axis];
    const trailing = geometry[2 + axis];
    console.log(leading, '-', trailing, 'in', grid);
    const next_leading = grid.findIndex(line => leading < line);
    const next_trailing = grid.findIndex(line => trailing < line);
    if (next_leading < 0) {
        return 0;
    } else if (next_trailing < 0) {
        if (next_leading == grid.length - 1) {
            return 0;
        } else {
            return grid[next_leading] - leading;
        }
    } else {
        const leading_delta = grid[next_leading] - leading;
        const trailing_delta = grid[next_trailing] - trailing;
        if (leading_delta < trailing_delta) {
            return leading_delta;
        } else {
            return trailing_delta;
        }
    }
}

function moveNegative(axis: number): number {
    const grid = computeGrid(axis).reverse();
    const geometry = geometries().get(activeWindowId());
    const leading = geometry[0 + axis];
    const trailing = geometry[2 + axis];
    const next_leading = grid.findIndex(line => line < leading);
    const next_trailing = grid.findIndex(line => line < trailing);
    if (next_trailing < 0) {
        return 0;
    } else if (next_leading < 0) {
        if (next_trailing == grid.length - 1) {
            return 0;
        } else {
            return grid[next_trailing] - trailing;
        }
    } else {
        const leading_delta = grid[next_leading] - leading;
        const trailing_delta = grid[next_trailing] - trailing;
        if (leading_delta > trailing_delta) {
            return leading_delta;
        } else {
            return trailing_delta;
        }
    }
}

function resizePositive(axis: number): number {
    const grid = computeGrid(axis);
    const geometry = geometries().get(activeWindowId());
    const trailing = geometry[2 + axis];
    const data = resizeData();
    const next_trailing = grid.findIndex(line => (trailing + data[axis][2] - 1) < line);
    if (next_trailing < 0) {
        return 0;
    } else {
        return grid[next_trailing] - trailing;
    }
}

function resizeNegative(axis: number): number {
    const grid = computeGrid(axis).reverse();
    const geometry = geometries().get(activeWindowId());
    const leading = geometry[0 + axis];
    const trailing = geometry[2 + axis];
    const next_trailing = grid.findIndex(line => line < trailing);
    if (next_trailing < 0) {
        return 0;
    } else {
        if (grid[next_trailing] <= leading)
            return 0;
        else
            return grid[next_trailing] - trailing;
    }
}

function moveWindow(x_delta: number, y_delta: number) {
    const geometry = geometries().get(activeWindowId());
    const cmd = `xdotool windowmove ${activeWindowId()} ${geometry[0] + x_delta} ${geometry[1] + y_delta}`;
    console.log(cmd);
    shell.exec(cmd);
}

function moveLeft() {
    moveWindow(moveNegative(X_AXIS), 0);
}

function moveRight() {
    moveWindow(movePositive(X_AXIS), 0);
}

function moveUp() {
    moveWindow(0, moveNegative(Y_AXIS));
}

function moveDown() {
    moveWindow(0, movePositive(Y_AXIS));
}

function resizeWindow(x_delta: number, y_delta: number) {
    console.log("Resize", x_delta, y_delta);
    const data = resizeData();
    console.log(data);
    const w = (data[X_AXIS][0] + Math.floor(x_delta / data[X_AXIS][2])) * data[X_AXIS][2] + data[X_AXIS][1];
    const h = (data[Y_AXIS][0] + Math.floor(y_delta / data[Y_AXIS][2])) * data[Y_AXIS][2] + data[Y_AXIS][1];
    const cmd = `xdotool windowsize ${activeWindowDirectId()} ${w} ${h}`;
    console.log(cmd);
    shell.exec(cmd);
}

function resizeLeft() {
    resizeWindow(resizeNegative(X_AXIS), 0);
}

function resizeRight() {
    resizeWindow(resizePositive(X_AXIS), 0);
}

function resizeUp() {
    resizeWindow(0, resizeNegative(Y_AXIS));
}

function resizeDown() {
    resizeWindow(0, resizePositive(Y_AXIS));
}

require('yargs')
    .scriptName("move-resize-on-grid")
    .usage('$0 <cmd>')
    .command('x+', 'Move window right', {}, moveRight)
    .command('x-', 'Move window left', {}, moveLeft)
    .command('y+', 'Move window down', {}, moveDown)
    .command('y-', 'Move window up', {}, moveUp)
    .command('w+', 'Increase width', {}, resizeRight)
    .command('w-', 'Decrease width', {}, resizeLeft)
    .command('h+', 'Increase height', {}, resizeDown)
    .command('h-', 'Decrease height', {}, resizeUp)
    .help()
    .argv