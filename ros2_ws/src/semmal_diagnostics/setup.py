import os
from glob import glob
from setuptools import setup

package_name = 'semmal_diagnostics'

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
    description='Deterministic motor/encoder/watchdog fault detection.',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'diagnostics_node = semmal_diagnostics.diagnostics_node:main',
        ],
    },
)
