#!/usr/bin/env python3
"""Kacy's hand on the Mac mouse. Reads one command per line on stdin and posts real mouse events.
Needs no packages: it talks to macOS CoreGraphics directly. Coordinates for m/d/u/r/s are 0..1 of
the main display; C takes absolute screen points.

  m x y          move (drag if the button is held)
  d x y / u x y  left button down / up
  r x y          right click
  c x y n        click in place (n = 1 or 2)
  k n btn        click at the current cursor position
  s dy           scroll (positive = up)
  C x y n btn    click at absolute points, n = 1 or 2, btn = left|right
"""
import sys, time, ctypes, ctypes.util

try:
    if not ctypes.util.find_library("ApplicationServices"):
        raise OSError("CoreGraphics not found")
    cg = ctypes.CDLL(ctypes.util.find_library("ApplicationServices"))
    cf = ctypes.CDLL(ctypes.util.find_library("CoreFoundation"))
except Exception as e:  # not macOS
    print("unavailable " + str(e), flush=True)
    sys.exit(3)

class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

V, U32, I32 = ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int32
cg.CGEventCreateMouseEvent.restype = V
cg.CGEventCreateMouseEvent.argtypes = [V, U32, CGPoint, U32]
cg.CGEventCreateScrollWheelEvent2.restype = V
cg.CGEventCreateScrollWheelEvent2.argtypes = [V, U32, U32, I32, I32, I32]
cg.CGEventPost.argtypes = [U32, V]
cg.CGEventSetIntegerValueField.argtypes = [V, U32, ctypes.c_int64]
cg.CGMainDisplayID.restype = U32
cg.CGDisplayPixelsWide.argtypes = [U32]
cg.CGDisplayPixelsWide.restype = ctypes.c_size_t
cg.CGDisplayPixelsHigh.argtypes = [U32]
cg.CGDisplayPixelsHigh.restype = ctypes.c_size_t
cf.CFRelease.argtypes = [V]
cg.CGEventCreate.restype = V
cg.CGEventCreate.argtypes = [V]
cg.CGEventGetLocation.restype = CGPoint
cg.CGEventGetLocation.argtypes = [V]

MOVED, L_DOWN, L_UP, R_DOWN, R_UP, L_DRAG = 5, 1, 2, 3, 4, 6
CLICK_STATE = 1
held = False
last = [0.0, 0.0, 0.0, 1]  # time, x, y, click count

def size():
    d = cg.CGMainDisplayID()
    return float(cg.CGDisplayPixelsWide(d)), float(cg.CGDisplayPixelsHigh(d))

def post(kind, x, y, button=0, clicks=0):
    ev = cg.CGEventCreateMouseEvent(None, kind, CGPoint(x, y), button)
    if not ev:
        return
    if clicks:
        cg.CGEventSetIntegerValueField(ev, CLICK_STATE, clicks)
    cg.CGEventPost(0, ev)
    cf.CFRelease(ev)

def clamp(v, hi):
    return max(0.0, min(hi - 1.0, v))

w, h = size()
print("ok %d %d" % (w, h), flush=True)
for line in sys.stdin:
    p = line.split()
    if not p:
        continue
    try:
        c = p[0]
        if c in ("m", "d", "u", "r"):
            w, h = size()
            x, y = clamp(float(p[1]) * w, w), clamp(float(p[2]) * h, h)
            if c == "m":
                post(L_DRAG if held else MOVED, x, y)
            elif c == "d":
                post(MOVED, x, y); post(L_DOWN, x, y, 0, 1); held = True
            elif c == "u":
                post(L_UP, x, y, 0, 1); held = False
            else:
                post(MOVED, x, y); post(R_DOWN, x, y, 1, 1); post(R_UP, x, y, 1, 1)
        elif c == "c":  # click in place: button goes down and up at exactly the same point, so it is never read as a drag
            w, h = size()
            x, y = clamp(float(p[1]) * w, w), clamp(float(p[2]) * h, h)
            n = int(p[3]) if len(p) > 3 else 1
            now = time.time()
            if n == 1 and now - last[0] < 0.55 and abs(x - last[1]) < 10 and abs(y - last[2]) < 10:
                last[3] = min(last[3] + 1, 3)  # second quick click in the same spot = double click
            else:
                last[3] = 1
            last[0], last[1], last[2] = now, x, y
            post(MOVED, x, y)
            if n == 1:
                post(L_DOWN, x, y, 0, last[3]); post(L_UP, x, y, 0, last[3])
            else:
                for i in range(1, n + 1):
                    post(L_DOWN, x, y, 0, i); post(L_UP, x, y, 0, i)
        elif c == "k":  # click wherever the cursor is right now (voice: "click", "double click", "right click")
            ev = cg.CGEventCreate(None)
            pt = cg.CGEventGetLocation(ev); cf.CFRelease(ev)
            n = int(p[1]) if len(p) > 1 else 1
            right = len(p) > 2 and p[2] == "right"
            for i in range(1, n + 1):
                post(R_DOWN if right else L_DOWN, pt.x, pt.y, 1 if right else 0, i)
                post(R_UP if right else L_UP, pt.x, pt.y, 1 if right else 0, i)
        elif c == "s":
            ev = cg.CGEventCreateScrollWheelEvent2(None, 1, 1, int(float(p[1])), 0, 0)
            if ev:
                cg.CGEventPost(0, ev); cf.CFRelease(ev)
        elif c == "C":
            x, y, n = float(p[1]), float(p[2]), int(p[3]) if len(p) > 3 else 1
            right = len(p) > 4 and p[4] == "right"
            post(MOVED, x, y)
            for i in range(1, n + 1):
                post(R_DOWN if right else L_DOWN, x, y, 1 if right else 0, i)
                post(R_UP if right else L_UP, x, y, 1 if right else 0, i)
    except Exception as e:
        print("err " + str(e), flush=True)
