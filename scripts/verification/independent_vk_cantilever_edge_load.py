"""Independent von Kármán Ritz reference for a cantilever plate edge load.

The plate is L=2 m by B=1 m, t=0.2 m, E=30 GPa, nu=0. The left edge is
clamped in bending and fixed in plane; the other edges are natural/free. A
trapezoidal transverse line load acts on x=L, from -400 to -1600 kN/m as y
goes from 0 to B. This script minimizes the Föppl-von Kármán total potential
with polynomial Ritz fields (w=t_x^2 P_m(t_x)P_n(t_y), u,v=t_x P_mP_n).
The Q4 Rust implementation is not used to assemble this reference.

Run with Python 3 and no third-party packages:
    python3 scripts/verification/independent_vk_cantilever_edge_load.py
"""

import math

LENGTH = 2.0
WIDTH = 1.0
THICKNESS = 0.2
E_KN_M2 = 30_000_000.0
NU = 0.0
Q_START = -400.0
Q_END = -1600.0

GAUSS_X = [0.0198550717512319, 0.1016667612931866, 0.2372337950418355,
           0.4082826787521751, 0.5917173212478249, 0.7627662049581645,
           0.8983332387068134, 0.9801449282487681]
GAUSS_W = [0.0506142681451881, 0.1111905172266872, 0.1568533229389436,
           0.1813418916891810, 0.1813418916891810, 0.1568533229389436,
           0.1111905172266872, 0.0506142681451881]


def legendre_values(order, t):
    """P_n(2t-1) and its first two derivatives with respect to t."""
    z = 2.0 * t - 1.0
    p = [1.0]
    dz = [0.0]
    dzz = [0.0]
    if order:
        p.append(z)
        dz.append(1.0)
        dzz.append(0.0)
    for n in range(2, order + 1):
        c = 2 * n - 1
        p.append((c * z * p[-1] - (n - 1) * p[-2]) / n)
        dz.append((c * (p[-2] + z * dz[-1]) - (n - 1) * dz[-2]) / n)
        dzz.append((c * (2 * dz[-2] + z * dzz[-1]) - (n - 1) * dzz[-2]) / n)
    return [(p[i], 2.0 * dz[i], 4.0 * dzz[i]) for i in range(order + 1)]


def scalar_basis(order_x, order_y, x, y, factor_power):
    px = legendre_values(order_x, x / LENGTH)
    py = legendre_values(order_y, y / WIDTH)
    tx = x / LENGTH
    factor = tx**factor_power
    factor_t = factor_power * tx ** (factor_power - 1) if factor_power else 0.0
    factor_tt = (factor_power * (factor_power - 1) * tx ** (factor_power - 2)
                 if factor_power >= 2 else 0.0)
    values = []
    for p, pt, ptt in px:
        f = factor * p
        ft = factor_t * p + factor * pt
        ftt = factor_tt * p + 2 * factor_t * pt + factor * ptt
        for q, qt, qtt in py:
            values.append((f*q, ft*q/LENGTH, f*qt/WIDTH,
                           ftt*q/LENGTH**2, f*qtt/WIDTH**2,
                           ft*qt/(LENGTH*WIDTH)))
    return values


def solve_modes(order_x, order_y):
    modes = (order_x + 1) * (order_y + 1)
    size = 3 * modes
    points = []
    for ix, xi in enumerate(GAUSS_X):
        for iy, eta in enumerate(GAUSS_X):
            points.append((LENGTH*xi, WIDTH*eta, GAUSS_W[ix]*GAUSS_W[iy]*LENGTH*WIDTH,
                           scalar_basis(order_x, order_y, LENGTH*xi, WIDTH*eta, 2),
                           scalar_basis(order_x, order_y, LENGTH*xi, WIDTH*eta, 1)))

    edge_points = []
    for eta, weight in zip(GAUSS_X, GAUSS_W):
        edge_points.append((WIDTH*eta, weight*WIDTH,
                            scalar_basis(order_x, order_y, LENGTH, WIDTH*eta, 2)))

    rigidity = E_KN_M2 * THICKNESS**3 / (12.0 * (1.0 - NU**2))
    membrane = E_KN_M2 * THICKNESS / (1.0 - NU**2)
    shear = E_KN_M2 * THICKNESS / (2.0 * (1.0 + NU))

    def residual(z, factor):
        r = [0.0] * size
        wc, uc, vc = z[:modes], z[modes:2*modes], z[2*modes:]
        for _, _, weight, wb, ib in points:
            w = wx = wy = wxx = wyy = wxy = 0.0
            ux = uy = vx = vy = 0.0
            for i in range(modes):
                w += wc[i]*wb[i][0]
                wx += wc[i]*wb[i][1]
                wy += wc[i]*wb[i][2]
                wxx += wc[i]*wb[i][3]
                wyy += wc[i]*wb[i][4]
                wxy += wc[i]*wb[i][5]
                ux += uc[i]*ib[i][1]
                uy += uc[i]*ib[i][2]
                vx += vc[i]*ib[i][1]
                vy += vc[i]*ib[i][2]
            ex = ux + 0.5*wx*wx
            ey = vy + 0.5*wy*wy
            gamma = uy + vx + wx*wy
            nx = membrane*(ex + NU*ey)
            ny = membrane*(ey + NU*ex)
            nxy = shear*gamma
            for i, b in enumerate(wb):
                phi, phix, phiy, phixx, phiyy, phixy = b
                r[i] += weight*(rigidity*((wxx+NU*wyy)*phixx + (wyy+NU*wxx)*phiyy
                                          + 2*(1-NU)*wxy*phixy)
                                + nx*wx*phix + ny*wy*phiy
                                + nxy*(phix*wy + wx*phiy))
                r[modes+i] += weight*(nx*ib[i][1] + nxy*ib[i][2])
                r[2*modes+i] += weight*(ny*ib[i][2] + nxy*ib[i][1])
        for y, weight, wb in edge_points:
            q = factor*(Q_START + (Q_END-Q_START)*y/WIDTH)
            for i in range(modes):
                r[i] -= weight*q*wb[i][0]
        return r

    def solve_dense(a, b):
        n = len(b)
        m = [a[i][:] + [b[i]] for i in range(n)]
        for col in range(n):
            pivot = max(range(col, n), key=lambda row: abs(m[row][col]))
            if abs(m[pivot][col]) < 1e-18:
                raise RuntimeError("singular Ritz tangent")
            m[col], m[pivot] = m[pivot], m[col]
            value = m[col][col]
            for j in range(col, n+1):
                m[col][j] /= value
            for row in range(n):
                if row == col:
                    continue
                value = m[row][col]
                for j in range(col, n+1):
                    m[row][j] -= value*m[col][j]
        return [m[i][n] for i in range(n)]

    z = [0.0] * size
    for step in range(1, 11):
        load_factor = step / 10.0
        for _ in range(20):
            f = residual(z, load_factor)
            norm = math.sqrt(sum(value*value for value in f))
            if norm < 1e-9:
                break
            jac = [[0.0]*size for _ in range(size)]
            for j in range(size):
                dh = 1e-5 * max(abs(z[j]), 1e-3)
                plus, minus = z[:], z[:]
                plus[j] += dh
                minus[j] -= dh
                fp, fm = residual(plus, load_factor), residual(minus, load_factor)
                for i in range(size):
                    jac[i][j] = (fp[i]-fm[i])/(2*dh)
            increment = solve_dense(jac, [-value for value in f])
            scale = 1.0
            while scale > 1e-6:
                trial = [a+scale*b for a, b in zip(z, increment)]
                trial_norm = math.sqrt(sum(value*value for value in residual(trial, load_factor)))
                if trial_norm < norm:
                    z = trial
                    break
                scale *= 0.5
            else:
                raise RuntimeError(f"Ritz line search stalled at load={load_factor}")
        else:
            raise RuntimeError(f"Ritz Newton iteration failed at load={load_factor}")

    centre_x = scalar_basis(order_x, order_y, LENGTH/2, WIDTH/2, 2)
    tip_centre = scalar_basis(order_x, order_y, LENGTH, WIDTH/2, 2)
    w_mid = sum(z[i]*centre_x[i][0] for i in range(modes))
    w_tip = sum(z[i]*tip_centre[i][0] for i in range(modes))
    return abs(w_mid)/THICKNESS, abs(w_tip)/THICKNESS


for cutoff in (1, 2, 3, 4):
    print(f"polynomial modes={cutoff}x{cutoff}: midspan_w/h, tip_w/h="
          f"{solve_modes(cutoff, cutoff)}")
