# Dedaliano / Stabileo dependency

This adapter uses `dedaliano-engine` from
<https://github.com/lambdaclass/stabileo> at commit
`7d87e551b765c88956df95b375e0ef0befda53f7`.

The upstream engine is licensed under AGPL-3.0. Open FEM Studio keeps the
engine behind the versioned types in this crate so engine-specific structures
do not enter project files, the user interface, or future plate and solid
solver adapters.

The adapter performs local input validation and converts Open FEM units to the
upstream contract. Forces are kN, moments are kNm, geometry is m, Young's
modulus is MPa, area is m², and second moments/torsion constants are m⁴.
