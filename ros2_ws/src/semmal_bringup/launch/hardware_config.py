"""Supported hardware: which robot description body each model loads in Gazebo.

  create3     iRobot Create 3 (with a camera and 2D lidar added)  -> cleaner body (round, low)
  turtlebot4  Clearpath TurtleBot 4                               -> rover body
  jackal      Clearpath Jackal UGV                                -> field body
Kept in step with HARDWARE in packages/contracts (the platform's list).
"""

HARDWARE = {
    'create3': {'body': 'cleaner'},
    'turtlebot4': {'body': 'rover'},
    'jackal': {'body': 'field'},
}


def body_for(model):
    if model not in HARDWARE:
        raise RuntimeError(f'unknown hardware {model!r}; supported: {", ".join(HARDWARE)}')
    return HARDWARE[model]['body']
