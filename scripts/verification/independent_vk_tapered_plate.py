"""Independent Fourier-Ritz reference for a geometrically nonlinear plate.

This solves the stationary Föppl-von Kármán energy equations with sine-series
trial fields, not the production Q4/hybrid-element equations. All four edges
are simply supported out of plane and fixed in plane (u=v=0). The applied
pressure is q(x,y)=q_max*x/a, with a=b=1, nu=0.316 and
q_max*a**4/(E*t**4)=51.4. E is normalized to 1 and t/a=0.05. The script prints
the center and quarter-midspan deflection divided by thickness for successively
larger m,n mode cutoffs. An 8x8 Gauss rule integrates the Ritz residual.

Run with Python 3 and no third-party packages:
    python3 scripts/verification/independent_vk_tapered_plate.py
"""

import math

NU = 0.316
T = 0.05
E = 1.0
QMAX = 51.4 * E * T**4

# 8-point Gauss-Legendre rule on [0,1].
X = [0.0198550717512319, 0.1016667612931866, 0.2372337950418355, 0.4082826787521751,
     0.5917173212478249, 0.7627662049581645, 0.8983332387068134, 0.9801449282487681]
W = [0.0506142681451881, 0.1111905172266872, 0.1568533229389436, 0.1813418916891810,
     0.1813418916891810, 0.1568533229389436, 0.1111905172266872, 0.0506142681451881]


def make_ref(K):
    modes = [(m, n) for m in range(1, K + 1) for n in range(1, K + 1)]
    points = []
    for ix, x in enumerate(X):
        for iy, y in enumerate(X):
            basis = []
            for m, n in modes:
                sx, sy = math.sin(math.pi*m*x), math.sin(math.pi*n*y)
                cx, cy = math.cos(math.pi*m*x), math.cos(math.pi*n*y)
                px, py = math.pi*m, math.pi*n
                basis.append((sx*sy, px*cx*sy, py*sx*cy,
                              -px*px*sx*sy, -py*py*sx*sy, px*py*cx*cy))
            points.append((x, y, W[ix]*W[iy], basis))
    nmode = len(modes)
    size = nmode * 3
    D = E*T**3/(12*(1-NU**2))
    A = E*T/(1-NU**2)
    G = E*T/(2*(1+NU))

    def residual(z, load_factor):
        r = [0.0]*size
        wu, uu, vu = z[:nmode], z[nmode:2*nmode], z[2*nmode:]
        for x, y, wt, basis in points:
            wx=wy=wxx=wyy=wxy=ux=uy=vx=vy=w=0.0
            for k, b in enumerate(basis):
                phi, phix, phiy, phixx, phiyy, phixy = b
                w += wu[k]*phi
                wx += wu[k]*phix; wy += wu[k]*phiy
                wxx += wu[k]*phixx; wyy += wu[k]*phiyy; wxy += wu[k]*phixy
                ux += uu[k]*phix; uy += uu[k]*phiy
                vx += vu[k]*phix; vy += vu[k]*phiy
            ex = ux + 0.5*wx*wx
            ey = vy + 0.5*wy*wy
            gxy = uy + vx + wx*wy
            nx = A*(ex + NU*ey)
            ny = A*(ey + NU*ex)
            nxy = G*gxy
            for k, b in enumerate(basis):
                phi, phix, phiy, phixx, phiyy, phixy = b
                r[k] += wt*(D*((wxx+NU*wyy)*phixx + (wyy+NU*wxx)*phiyy + 2*(1-NU)*wxy*phixy)
                            + nx*wx*phix + ny*wy*phiy + nxy*(phix*wy + wx*phiy)
                            - load_factor*QMAX*x*phi)
                r[nmode+k] += wt*(nx*phix + nxy*phiy)
                r[2*nmode+k] += wt*(ny*phiy + nxy*phix)
        return r

    def solve_linear(A, b):
        n=len(b)
        M=[A[i][:]+[b[i]] for i in range(n)]
        for k in range(n):
            p=max(range(k,n),key=lambda i:abs(M[i][k]))
            if abs(M[p][k]) < 1e-20: raise RuntimeError('singular Ritz tangent')
            M[k],M[p]=M[p],M[k]
            d=M[k][k]
            for j in range(k,n+1): M[k][j]/=d
            for i in range(n):
                if i==k: continue
                c=M[i][k]
                if c:
                    for j in range(k,n+1): M[i][j]-=c*M[k][j]
        return [M[i][n] for i in range(n)]

    z=[0.0]*size
    for step in range(1,11):
        lam=step/10
        for it in range(20):
            f=residual(z,lam)
            norm=math.sqrt(sum(v*v for v in f))
            if norm < 1e-12*QMAX: break
            J=[[0.0]*size for _ in range(size)]
            for j in range(size):
                dh=1e-5*max(abs(z[j]), 1e-4)
                zp=z[:]; zm=z[:]; zp[j]+=dh; zm[j]-=dh
                fp=residual(zp,lam); fm=residual(zm,lam)
                for i in range(size): J[i][j]=(fp[i]-fm[i])/(2*dh)
            dz=solve_linear(J,[-v for v in f])
            alpha=1.0
            while alpha>1e-6:
                zn=[a+alpha*b for a,b in zip(z,dz)]
                fn=residual(zn,lam)
                if math.sqrt(sum(v*v for v in fn)) < norm:
                    z=zn; break
                alpha*=0.5
            else: raise RuntimeError(f'line search failed K={K} load={lam} r={norm}')
        else: raise RuntimeError(f'Newton failed K={K} load={lam} r={norm}')
    center=sum(z[k]*math.sin(math.pi*m/2)*math.sin(math.pi*n/2)
               for k,(m,n) in enumerate(modes))
    quarter=sum(z[k]*math.sin(math.pi*m/4)*math.sin(math.pi*n/2) for k,(m,n) in enumerate(modes))
    return center/T, quarter/T, math.sqrt(sum(v*v for v in residual(z,1.0)))

for k in (1, 2, 3, 4, 5):
    centre, quarter_mid, residual_norm = make_ref(k)
    print(f"modes={k}x{k}: centre_w/h={centre:.9f}, "
          f"quarter_mid_w/h={quarter_mid:.9f}, residual={residual_norm:.3e}")
