import os
from glob import glob
from setuptools import setup

package_name = 'semmal_base'

setup(
    name=package_name,
    version='0.1.0',
    packages=[package_name],
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='semmal',
    maintainer_email='cvineetjonathan@gmail.com',
    description='Motor/encoder model, battery model and robot state aggregation for the SEMMAL Gazebo plant.',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'motor_sim_node = semmal_base.motor_sim_node:main',
            'battery_node = semmal_base.battery_node:main',
            'robot_state_node = semmal_base.robot_state_node:main',
        ],
    },
)
