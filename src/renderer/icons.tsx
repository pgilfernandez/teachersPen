import type { ComponentType } from 'react';
import InfoSource from './assets/icons/info.svg';
import PencilSource from './assets/icons/pencil.svg';
import SlashSource from './assets/icons/slash.svg';
import ArrowUpRightSource from './assets/icons/arrow-up-right.svg';
import RectangleHorizontalSource from './assets/icons/rectangle-horizontal.svg';
import CircleSource from './assets/icons/circle.svg';
import Undo2Source from './assets/icons/undo2.svg';
import Redo2Source from './assets/icons/redo2.svg';
import Trash2Source from './assets/icons/trash2.svg';
import EyeSource from './assets/icons/eye.svg';
import EyeOffSource from './assets/icons/eye-off.svg';
import SettingsSource from './assets/icons/settings.svg';
import TimerSource from './assets/icons/timer.svg';
import GripVerticalSource from './assets/icons/grip-vertical.svg';
import MoveDiagonalSource from './assets/icons/move-diagonal.svg';
import RotateCcwSource from './assets/icons/rotate-ccw.svg';
import ArrowDownUpSource from './assets/icons/arrow-down-up.svg';
import PlaySource from './assets/icons/play.svg';
import PauseSource from './assets/icons/pause.svg';
import PanelTopCloseSource from './assets/icons/panel-top-close.svg';
import RotateCwSource from './assets/icons/rotate-cw.svg';
import PowerSource from './assets/icons/power.svg';
import XSource from './assets/icons/x.svg';
import WhiteboardSource from './assets/icons/whiteboard.svg';
import BlackboardSource from './assets/icons/blackboard.svg';

export type EditableIcon = ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>;

// SVG files are the editable source of truth; retain their artwork and inherited colors.
function icon(source: string): EditableIcon {
  return function Icon({ size = 24, 'aria-hidden': hidden = true }) {
    const markup = source.replace(/<\?xml[^>]*\?>/g, '').replace(/<svg\b[^>]*>/, root => root.replace(/\s(?:width|height)="[^"]*"/g, '').replace(/>$/, ' width="' + size + '" height="' + size + '">'));
    return <span style={{ display: 'contents' }} aria-hidden={hidden} dangerouslySetInnerHTML={{ __html: markup }} />;
  };
}

export const Pencil = icon(PencilSource);
export const Slash = icon(SlashSource);
export const ArrowUpRight = icon(ArrowUpRightSource);
export const RectangleHorizontal = icon(RectangleHorizontalSource);
export const Circle = icon(CircleSource);
export const Undo2 = icon(Undo2Source);
export const Redo2 = icon(Redo2Source);
export const Trash2 = icon(Trash2Source);
export const Eye = icon(EyeSource);
export const EyeOff = icon(EyeOffSource);
export const Settings = icon(SettingsSource);
export const Timer = icon(TimerSource);
export const GripVertical = icon(GripVerticalSource);
export const MoveDiagonal = icon(MoveDiagonalSource);
export const RotateCcw = icon(RotateCcwSource);
export const ArrowDownUp = icon(ArrowDownUpSource);
export const Play = icon(PlaySource);
export const Pause = icon(PauseSource);
export const PanelTopClose = icon(PanelTopCloseSource);
export const RotateCw = icon(RotateCwSource);
export const Power = icon(PowerSource);
export const X = icon(XSource);
export const Whiteboard = icon(WhiteboardSource);
export const Blackboard = icon(BlackboardSource);

export const Info = icon(InfoSource);
