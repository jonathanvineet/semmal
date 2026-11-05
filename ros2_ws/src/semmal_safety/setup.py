import os
from glob import glob
from setuptools import setup

package_name = 'semmal_safety'

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
    description='Safety supervisor: the only publisher of the final /cmd_vel.',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'safety_supervisor = semmal_safety.safety_supervisor_node:main',
        ],
    },
)
