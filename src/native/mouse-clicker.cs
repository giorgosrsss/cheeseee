using System;
using System.Runtime.InteropServices;
using System.Threading;

public class MouseClicker {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern IntPtr WindowFromPoint(POINT Point);

    [DllImport("user32.dll")]
    public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP   = 0x0004;
    private const uint GA_ROOT              = 2;

    public static void RunOnDesktop(Action action) {
        Thread t = new Thread(() => {
            try {
                IntPtr desk = OpenInputDesktop(0, false, 0x01FF);
                if (desk != IntPtr.Zero) {
                    SetThreadDesktop(desk);
                }
            } catch {}
            action();
        });
        t.IsBackground = true;
        t.Start();
        t.Join();
    }

    public static void FocusTargetWindow(int x, int y) {
        try {
            POINT pt = new POINT { X = x, Y = y };
            IntPtr w = WindowFromPoint(pt);
            if (w != IntPtr.Zero) {
                IntPtr root = GetAncestor(w, GA_ROOT);
                if (root != IntPtr.Zero) {
                    SetForegroundWindow(root);
                }
            }
        } catch {}
    }

    public static void ClickAt(int x, int y, int pressMs) {
        RunOnDesktop(() => {
            FocusTargetWindow(x, y);
            SetCursorPos(x, y);
            Thread.Sleep(30);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            Thread.Sleep(pressMs > 0 ? pressMs : 40);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        });
    }

    public static void MovePiece(int fromX, int fromY, int toX, int toY, string mode, bool restoreCursor, int delayMs) {
        RunOnDesktop(() => {
            POINT orig = new POINT();
            bool gotOrig = false;
            if (restoreCursor) {
                gotOrig = GetCursorPos(out orig);
            }

            // Ensure the target browser/board window under cursor has focus
            FocusTargetWindow(fromX, fromY);
            Thread.Sleep(25);

            // If from == to, it's a test move / single square click
            if (fromX == toX && fromY == toY) {
                SetCursorPos(fromX, fromY);
                Thread.Sleep(35);
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                Thread.Sleep(40);
                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                return;
            }

            if (mode == "drag") {
                // Drag and drop: LeftDown on source -> smooth drag -> LeftUp on destination
                SetCursorPos(fromX, fromY);
                Thread.Sleep(35);
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                Thread.Sleep(40);

                int steps = 12;
                for (int i = 1; i <= steps; i++) {
                    int cx = fromX + (toX - fromX) * i / steps;
                    int cy = fromY + (toY - fromY) * i / steps;
                    SetCursorPos(cx, cy);
                    Thread.Sleep(10);
                }
                SetCursorPos(toX, toY);
                Thread.Sleep(40);

                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
            } else {
                // Click-to-move (default): Click source square -> wait delayMs -> Click destination square
                // Standard universal move supported by all chess platforms
                SetCursorPos(fromX, fromY);
                Thread.Sleep(35);
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                Thread.Sleep(45);
                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);

                Thread.Sleep(delayMs > 0 ? delayMs : 70);

                SetCursorPos(toX, toY);
                Thread.Sleep(35);
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                Thread.Sleep(45);
                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
            }

            if (restoreCursor && gotOrig) {
                Thread.Sleep(50);
                SetCursorPos(orig.X, orig.Y);
            }
        });
    }

    public static POINT GetPos() {
        POINT p = new POINT();
        RunOnDesktop(() => {
            GetCursorPos(out p);
        });
        return p;
    }

    public static void Main(string[] args) {
        try {
            // Per-monitor v2 DPI aware (-4)
            SetProcessDpiAwarenessContext((IntPtr)(-4));
        } catch {
            try { SetProcessDPIAware(); } catch {}
        }

        // CLI getpos
        if (args.Length >= 1 && args[0].ToLower() == "getpos") {
            POINT p = GetPos();
            Console.WriteLine("POS " + p.X + " " + p.Y);
            return;
        }

        // CLI single click: mouse-clicker.exe <x> <y>
        if (args.Length == 2) {
            int x = int.Parse(args[0]);
            int y = int.Parse(args[1]);
            ClickAt(x, y, 40);
            Console.WriteLine("OK");
            return;
        }

        // CLI move: mouse-clicker.exe <fromX> <fromY> <toX> <toY> [mode] [restore:0|1] [delay]
        if (args.Length >= 4) {
            int x1 = int.Parse(args[0]);
            int y1 = int.Parse(args[1]);
            int x2 = int.Parse(args[2]);
            int y2 = int.Parse(args[3]);
            string mode = args.Length > 4 ? args[4].ToLower() : "click";
            bool restore = args.Length > 5 ? args[5] != "0" : true;
            int delay = args.Length > 6 ? int.Parse(args[6]) : 70;
            MovePiece(x1, y1, x2, y2, mode, restore, delay);
            Console.WriteLine("OK");
            return;
        }

        Console.WriteLine("READY");
        string line;
        while ((line = Console.ReadLine()) != null) {
            line = line.Trim();
            if (line == "exit" || line == "quit") break;
            if (string.IsNullOrEmpty(line)) continue;
            try {
                string[] parts = line.Split(' ');
                string cmd = parts[0].ToUpper();
                if (cmd == "MOVE" && parts.Length >= 5) {
                    int x1 = int.Parse(parts[1]);
                    int y1 = int.Parse(parts[2]);
                    int x2 = int.Parse(parts[3]);
                    int y2 = int.Parse(parts[4]);
                    string mode = parts.Length > 5 ? parts[5].ToLower() : "click";
                    bool restore = parts.Length > 6 ? parts[6] != "0" : true;
                    int delay = parts.Length > 7 ? int.Parse(parts[7]) : 70;
                    MovePiece(x1, y1, x2, y2, mode, restore, delay);
                    Console.WriteLine("OK");
                } else if (cmd == "CLICK" && parts.Length >= 3) {
                    int x = int.Parse(parts[1]);
                    int y = int.Parse(parts[2]);
                    ClickAt(x, y, 40);
                    Console.WriteLine("OK");
                } else if (cmd == "GETPOS") {
                    POINT p = GetPos();
                    Console.WriteLine("POS " + p.X + " " + p.Y);
                } else if (cmd == "PING") {
                    Console.WriteLine("PONG");
                } else {
                    Console.WriteLine("ERR invalid command");
                }
            } catch (Exception ex) {
                Console.WriteLine("ERR " + ex.Message);
            }
        }
    }
}
