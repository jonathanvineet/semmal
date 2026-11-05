import os
from glob import glob
from setuptools import setup

package_name = 'semmal_mission'

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
    description='ExecuteMission action server: allowlisted named waypoints over a route graph.',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'mission_executor = semmal_mission.mission_executor_node:main',
        ],
    },
)
